import {defineConfig,devices} from '@playwright/test';

// Uses the installed Chrome browser. No browser download or server launch is implicit.
// Start the demo with `npm run dev` before `npm run test:e2e`.
export default defineConfig({
 testDir:'./tests/e2e', fullyParallel:true, forbidOnly:!!process.env.CI,
 retries:process.env.CI?1:0, reporter:'list',
 outputDir:'./test-results',
 use:{baseURL:'http://localhost:5173',trace:'retain-on-failure',screenshot:'only-on-failure'},
 projects:[
  {name:'desktop-1440',use:{...devices['Desktop Chrome'],channel:'chrome',viewport:{width:1440,height:1000}}},
  {name:'mobile-375',use:{...devices['Desktop Chrome'],channel:'chrome',viewport:{width:375,height:812}}},
 ],
});
