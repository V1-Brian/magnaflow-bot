import dotenv from 'dotenv';
dotenv.config();

import { chat } from '../../src/services/claude.js';
import { CASES } from './cases.js';

async function runCase(testCase) {
  let history = [];
  let lastResult;

  for (const turn of testCase.turns) {
    lastResult = await chat(history, turn);
    history = lastResult.history;
  }

  const skus = (lastResult.fitmentResults ?? []).map((p) => p.sku);
  const errors = [];

  for (const sku of testCase.expectSkus ?? []) {
    if (!skus.includes(sku)) errors.push(`expected SKU ${sku} in results, got [${skus.join(',')}]`);
  }
  for (const sku of testCase.rejectSkus ?? []) {
    if (skus.includes(sku)) errors.push(`SKU ${sku} should NOT be in results, got [${skus.join(',')}]`);
  }
  if (testCase.expectNoFitmentYet && lastResult.fitmentResults !== null) {
    errors.push(`expected no fitment results yet, got [${skus.join(',')}]`);
  }

  return { name: testCase.name, pass: errors.length === 0, errors, skus, reply: lastResult.message };
}

async function main() {
  const nameFilter = process.argv[2];
  const cases = nameFilter ? CASES.filter((c) => c.name.toLowerCase().includes(nameFilter.toLowerCase())) : CASES;

  if (cases.length === 0) {
    console.log(`No test cases match "${nameFilter}".`);
    return;
  }

  const results = [];
  for (const testCase of cases) {
    process.stdout.write(`${testCase.name}... `);
    try {
      const result = await runCase(testCase);
      results.push(result);
      console.log(result.pass ? 'PASS' : `FAIL — ${result.errors.join('; ')}`);
    } catch (err) {
      results.push({ name: testCase.name, pass: false, errors: [err.message] });
      console.log(`ERROR — ${err.message}`);
    }
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) {
    console.log('\nFailures (full detail):');
    for (const f of failed) {
      console.log(`\n- ${f.name}`);
      console.log(`  ${f.errors.join('\n  ')}`);
      if (f.reply) console.log(`  Bot's final reply: ${f.reply.slice(0, 300)}${f.reply.length > 300 ? '…' : ''}`);
    }
    process.exitCode = 1;
  }
}

main();
