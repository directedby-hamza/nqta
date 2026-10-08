import { defineConfig } from '@playwright/test';
import password from './playwright.password.config';
export default defineConfig({ ...password, testMatch: ['wallet-cards.spec.ts'] });
