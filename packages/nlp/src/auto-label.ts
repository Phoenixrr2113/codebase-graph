import { createLogger } from '@codegraph/logger';
import type { Sample, AnnotatedSample } from '@codegraph/types';
import { EntityExtractor } from './extractor';
import { loadSamples, saveAnnotations } from './storage';

const logger = createLogger({ namespace: 'nlp:auto-label' });

export type AutoLabelConfig = {
  model: string | undefined;
  batchSize: number | undefined;
  onProgress: ((current: number, total: number, sample: AnnotatedSample) => void) | undefined;
};

export async function autoLabel(
  samples: Sample[],
  config: Partial<AutoLabelConfig> = {}
): Promise<AnnotatedSample[]> {
  logger.info(`autoLabel started: ${samples.length} samples`);

  const extractor = new EntityExtractor(config.model ? { model: config.model } : {});
  const batchSize = config.batchSize ?? 10;
  const results: AnnotatedSample[] = [];

  for (let i = 0; i < samples.length; i += batchSize) {
    const batch = samples.slice(i, i + batchSize);
    logger.debug(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} samples`);

    try {
      const batchResults = await extractor.extractBatch(batch);
      results.push(...batchResults);

      if (config.onProgress) {
        for (const result of batchResults) {
          config.onProgress(results.length, samples.length, result);
        }
      }
    } catch (error) {
      logger.error(`Failed to process batch starting at ${i}`, error);
    }
  }

  logger.info(`autoLabel completed: ${results.length} results`);
  return results;
}

export async function autoLabelFromFiles(
  samplesPath: string,
  outputPath: string,
  config: Partial<AutoLabelConfig> = {}
): Promise<AnnotatedSample[]> {
  logger.info(`autoLabelFromFiles: samples=${samplesPath}, output=${outputPath}`);

  const samples = loadSamples(samplesPath);
  const results = await autoLabel(samples, config);

  saveAnnotations(outputPath, results);

  logger.info(`autoLabelFromFiles completed: ${results.length} results saved to ${outputPath}`);
  return results;
}

export async function labelSingle(
  sample: Sample,
  config: Partial<AutoLabelConfig> = {}
): Promise<AnnotatedSample> {
  const extractor = new EntityExtractor(config.model ? { model: config.model } : {});
  return extractor.extract(sample);
}
