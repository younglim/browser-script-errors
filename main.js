const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

function sanitizeFilename(input) {
  return input.replace(/[\/\\:*?"<>|%]/g, '-');
}

function getTimestampForFilename() {
  const now = new Date();
  return now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
}

function getISOTime() {
  return new Date().toISOString();
}

(async () => {
  const urlToScan = process.argv[2];
  if (!urlToScan) {
    console.error('Usage: node scanSite.js <url>');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const resourceErrors = [];
  const resourceWarnings = [];
  let mainResponseStatus = '';

  const scanTime = getISOTime();

  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error') {
      resourceErrors.push({
        errorType: 'jsError',
        message: msg.text(),
        timestamp: getISOTime(),
      });
    } else if (type === 'warning') {
      resourceWarnings.push({
        warningType: 'jsWarning',
        message: msg.text(),
        timestamp: getISOTime(),
      });
    }
  });

  page.on('requestfailed', request => {
    resourceErrors.push({
      errorType: 'requestFailed',
      message: `${request.url()} - ${request.failure().errorText}`,
      timestamp: getISOTime(),
    });
  });

  page.on('response', response => {
    const status = response.status();
    const url = response.url();

    if (status >= 500) {
      resourceErrors.push({
        errorType: 'resourceResponseError',
        statusCode: status.toString(),
        message: `${url} - Status: ${status}`,
        timestamp: getISOTime(),
      });
    } else if (status >= 300) {
      resourceWarnings.push({
        warningType: 'resourceResponseWarning',
        statusCode: status.toString(),
        message: `${url} - Status: ${status}`,
        timestamp: getISOTime(),
      });
    }
  });

  try {
    const response = await page.goto(urlToScan, { waitUntil: 'domcontentloaded' });
    if (response) {
      mainResponseStatus = response.status().toString();
    }
    console.log('Scan complete.');
  } catch (err) {
    resourceErrors.push({
      errorType: 'navigationError',
      message: err.message,
      timestamp: getISOTime(),
    });
  }

  await browser.close();

  const parsedUrl = new URL(urlToScan);
  const domain = sanitizeFilename(parsedUrl.hostname);
  const pathName = sanitizeFilename(parsedUrl.pathname || 'root') || 'root';
  const timestamp = getTimestampForFilename();
  const fileName = `${domain}-${pathName}-${timestamp}.json`;
  const resultsDir = path.join(process.cwd(), 'results');
  const outputPath = path.join(resultsDir, fileName);

  fs.mkdirSync(resultsDir, { recursive: true });

  const output = {
    url: urlToScan,
    scanTime,
    ...(mainResponseStatus && { statusCode: mainResponseStatus }),
    resourceErrors,
    resourceWarnings,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Results written to ${outputPath}`);
})();
