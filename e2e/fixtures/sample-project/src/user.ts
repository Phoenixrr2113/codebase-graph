/**
 * Sample project for E2E testing
 * Contains a simple user management module
 */

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export function createUser(name: string, email: string): User {
  return {
    id: generateId(),
    name,
    email,
    createdAt: new Date(),
  };
}

export function updateUser(user: User, updates: Partial<User>): User {
  return {
    ...user,
    ...updates,
  };
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}
