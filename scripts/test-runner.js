/**
 * QPartner Automated Test Runner & Verification Suite
 * Executes unit, service, concurrency, and lifecycle test specs.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('====================================================');
console.log('🧪 RUNNING QPARTNER PRODUCTION VERIFICATION TEST SUITE');
console.log('====================================================\n');

const testDir = path.join(__dirname, '..', '__tests__');
if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
}

let totalPassed = 0;
let totalFailed = 0;
const results = [];

function runTestFile(file) {
    const filePath = path.join(testDir, file);
    console.log(`▶ Executing: ${file}`);
    try {
        require(filePath);
        console.log(`✅ Passed: ${file}\n`);
        totalPassed++;
        results.push({ file, status: 'PASSED' });
    } catch (err) {
        console.error(`❌ FAILED: ${file}`);
        console.error(err.stack || err);
        console.log('');
        totalFailed++;
        results.push({ file, status: 'FAILED', error: err.message });
    }
}

const testFiles = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.js'));

if (testFiles.length === 0) {
    console.log('No test files found in __tests__ directory.');
} else {
    for (const file of testFiles) {
        runTestFile(file);
    }
}

console.log('====================================================');
console.log(`TEST SUMMARY: ${totalPassed} Passed, ${totalFailed} Failed out of ${testFiles.length} Test Suites`);
console.log('====================================================');

if (totalFailed > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
