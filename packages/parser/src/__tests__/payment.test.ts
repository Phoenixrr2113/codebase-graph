/**
 * Payment Security Rules Tests
 * Tests for detecting payment processing vulnerabilities
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  scanForPaymentVulnerabilities,
  scanFileForPaymentIssues,
  getPaymentVulnerabilityTypes,
} from '../analysis/rules/payment';
import { SecurityFinding } from '../analysis/security';
import { initParser, parseCode } from '../index';

// Initialize parser before tests
beforeAll(async () => {
  await initParser();
});

describe('Payment Security Rules', () => {
  // Helper to parse code and scan for payment vulnerabilities
  async function scanPaymentCode(code: string): Promise<SecurityFinding[]> {
    const result = await parseCode(code, 'test.ts');
    if (!result?.rootNode) {
      throw new Error('Failed to parse code');
    }
    return scanForPaymentVulnerabilities(result.rootNode, { filePath: 'test.ts' });
  }

  describe('Unvalidated Payment Amount Detection', () => {
    it('should detect Stripe charge with user input amount', async () => {
      const code = `
        app.post('/pay', async (req, res) => {
          const charge = await stripe.charges.create({
            amount: req.body.amount,
            currency: 'usd',
            source: 'tok_visa'
          });
        });
      `;
      const findings = await scanPaymentCode(code);
      
      expect(findings.some(f => f.type === 'unvalidated_payment_amount')).toBe(true);
      expect(findings.find(f => f.type === 'unvalidated_payment_amount')?.severity).toBe('critical');
    });

    it('should detect Stripe paymentIntent with user input', async () => {
      const code = `
        const intent = await stripe.paymentIntents.create({
          amount: request.body.amount,
          currency: 'eur'
        });
      `;
      const findings = await scanPaymentCode(code);
      
      expect(findings.some(f => f.type === 'unvalidated_payment_amount')).toBe(true);
    });

    it('should not flag validated amounts', async () => {
      const code = `
        const order = await getOrder(orderId);
        const charge = await stripe.charges.create({
          amount: order.total,
          currency: 'usd'
        });
      `;
      const findings = await scanPaymentCode(code);
      
      const amountFindings = findings.filter(f => f.type === 'unvalidated_payment_amount');
      expect(amountFindings).toHaveLength(0);
    });
  });

  describe('PCI Data Logging Detection', () => {
    it('should detect console.log with card number', async () => {
      const code = `
        console.log('Card:', cardNumber);
      `;
      const findings = await scanPaymentCode(code);
      
      expect(findings.some(f => f.type === 'pci_data_logging')).toBe(true);
    });

    it('should detect logging with CVV', async () => {
      const code = `
        logger.debug('Processing payment', { cvv: card.cvv });
      `;
      const findings = await scanPaymentCode(code);
      
      expect(findings.some(f => f.type === 'pci_data_logging')).toBe(true);
    });

    it('should detect logging PAN data', async () => {
      const code = `
        console.log('PAN:', pan);
      `;
      const findings = await scanPaymentCode(code);
      
      expect(findings.some(f => f.type === 'pci_data_logging')).toBe(true);
    });

    it('should not flag logging non-sensitive data', async () => {
      const code = `
        console.log('Payment ID:', paymentId);
        logger.info('Order processed:', orderId);
      `;
      const findings = await scanPaymentCode(code);
      
      const pciFindings = findings.filter(f => f.type === 'pci_data_logging');
      expect(pciFindings).toHaveLength(0);
    });
  });

  describe('Hardcoded Payment Keys Detection', () => {
    it('should detect hardcoded Stripe live secret key', async () => {
      const code = `
        const stripe = require('stripe')('sk_live_TESTKEY_FAKE_DO_NOT_USE_123');
      `;
      const findings = await scanPaymentCode(code);
      
      expect(findings.some(f => f.type === 'hardcoded_payment_key')).toBe(true);
      expect(findings.find(f => f.type === 'hardcoded_payment_key')?.severity).toBe('critical');
    });

    it('should detect hardcoded Stripe test secret key', async () => {
      const code = `
        const stripe = new Stripe('sk_test_TESTKEY_FAKE_DO_NOT_USE_456');
      `;
      const findings = await scanPaymentCode(code);
      
      expect(findings.some(f => f.type === 'hardcoded_payment_key')).toBe(true);
    });

    it('should detect hardcoded Stripe webhook secret', async () => {
      const code = `
        const endpointSecret = 'whsec_TESTKEY_FAKE_DO_NOT_USE_789';
      `;
      const findings = await scanPaymentCode(code);
      
      expect(findings.some(f => f.type === 'hardcoded_payment_key')).toBe(true);
    });

    it('should not flag environment variable usage', async () => {
      const code = `
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      `;
      const findings = await scanPaymentCode(code);
      
      const keyFindings = findings.filter(f => f.type === 'hardcoded_payment_key');
      expect(keyFindings).toHaveLength(0);
    });
  });

  describe('Missing Idempotency Key Detection', () => {
    it('should detect charge creation without idempotency key', async () => {
      const code = `
        const charge = await stripe.charges.create({
          amount: 1000,
          currency: 'usd',
          source: 'tok_visa'
        });
      `;
      const findings = await scanPaymentCode(code);
      
      expect(findings.some(f => f.type === 'missing_idempotency_key')).toBe(true);
    });

    it('should detect payment intent without idempotency key', async () => {
      const code = `
        const intent = await stripe.paymentIntents.create({
          amount: 2000,
          currency: 'usd'
        });
      `;
      const findings = await scanPaymentCode(code);
      
      expect(findings.some(f => f.type === 'missing_idempotency_key')).toBe(true);
    });

    it('should not flag when idempotencyKey is present', async () => {
      const code = `
        const charge = await stripe.charges.create({
          amount: 1000,
          currency: 'usd',
          source: 'tok_visa'
        }, {
          idempotencyKey: uniqueOrderId
        });
      `;
      const findings = await scanPaymentCode(code);
      
      const idempotencyFindings = findings.filter(f => f.type === 'missing_idempotency_key');
      expect(idempotencyFindings).toHaveLength(0);
    });
  });

  describe('scanFileForPaymentIssues aggregation', () => {
    it('should return findings with categorized summary', async () => {
      const code = `
        const stripe = require('stripe')('sk_test_TESTKEY_FAKE_DO_NOT_USE_456');
        
        app.post('/pay', async (req, res) => {
          console.log('Card:', req.body.cardNumber);
          const charge = await stripe.charges.create({
            amount: req.body.amount,
            currency: 'usd'
          });
        });
      `;
      const result = await parseCode(code, 'test.ts');
      if (!result?.rootNode) throw new Error('Failed to parse');
      
      const { findings, summary } = scanFileForPaymentIssues(result.rootNode, 'test.ts');
      
      expect(findings.length).toBeGreaterThan(0);
      expect(summary.total).toBe(findings.length);
      expect(summary.hardcodedKeys).toBeGreaterThanOrEqual(1);
      expect(summary.pciLogging).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Utility functions', () => {
    it('should return all payment vulnerability types', () => {
      const types = getPaymentVulnerabilityTypes();
      
      expect(types).toContain('unvalidated_payment_amount');
      expect(types).toContain('pci_data_logging');
      expect(types).toContain('hardcoded_payment_key');
      expect(types).toContain('missing_idempotency_key');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty code', async () => {
      const findings = await scanPaymentCode('');
      expect(findings).toHaveLength(0);
    });

    it('should handle non-payment code', async () => {
      const code = `
        function add(a, b) {
          return a + b;
        }
      `;
      const findings = await scanPaymentCode(code);
      expect(findings).toHaveLength(0);
    });
  });
});
