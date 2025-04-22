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
    console.error('Usage: node main.js <url>');
    process.exit(1);
  }

  const browser = await chromium.launch({
      headless: false,  
      devtools: true, // open the browser’s devtools panel 
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();

  const allErrors = [];
  const allWarnings = [];
  const scanTime = getISOTime();

  let finalUrl = urlToScan;
  let mainResponseStatus = 'unknown';
  let lastMainFrameResponse = null;

  // Buffer all errors and warnings (filter later)
  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      const loc = msg.location(); // { url, lineNumber, columnNumber }
  
      allErrors.push({
        type,
        location: loc.url || 'unknown',
        line: loc.lineNumber ?? 0,
        message: msg.text(),
        timestamp: getISOTime(),
        url: page.url(),
      });
    }
  });  

  page.on('requestfailed', request => {
    const errorText = request.failure()?.errorText || '';
    if (!errorText.includes('ERR_ABORTED')) {
      allErrors.push({
        type: 'requestFailed',
        message: `${request.url()} - ${errorText}`,
        timestamp: getISOTime(),
        url: request.url(),
      });
    }
  });

  page.on('response', response => {
    const url = response.url();
    const status = response.status();
    const request = response.request();

    if (request.frame() === page.mainFrame() && request.resourceType() === 'document') {
      lastMainFrameResponse = response;
    }

    if (status >= 500) {
      allErrors.push({
        type: 'resourceResponseError',
        statusCode: status.toString(),
        message: `${url} - Status: ${status}`,
        timestamp: getISOTime(),
        url,
      });
    } else if (status >= 300) {
      allWarnings.push({
        type: 'resourceResponseWarning',
        statusCode: status.toString(),
        message: `${url} - Status: ${status}`,
        timestamp: getISOTime(),
        url,
      });
    }
  });

  try {
    await page.goto(urlToScan, { waitUntil: 'domcontentloaded' });

    for (let i = 0; i < 5; i++) {
      const previousUrl = finalUrl;
      finalUrl = page.url();

      const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);
      await Promise.race([nav, page.waitForTimeout(10000)]);

      if (finalUrl === previousUrl) break;
    }

    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    mainResponseStatus = lastMainFrameResponse?.status()?.toString() || 'unknown';
    console.log(`Resolved final URL: ${finalUrl} (status: ${mainResponseStatus})`);

  } catch (err) {
    allErrors.push({
      type: 'navigationError',
      message: err.message,
      timestamp: getISOTime(),
      url: finalUrl,
    });
  }

  await browser.close();

  // Only include errors matching final origin
  const finalOrigin = new URL(finalUrl).origin;
  const consoleErrors = allErrors.filter(e => new URL(e.url).origin === finalOrigin).map(e => {
    return {
      errorType: e.type,
      location: e.location,
      line: e.line,
      message: e.message,
      timestamp: e.timestamp,
      ...(e.statusCode && { statusCode: e.statusCode }),
      url: e.url,
    };
  });

  const resourceWarnings = allWarnings.filter(e => new URL(e.url).origin === finalOrigin).map(e => ({
    warningType: e.type,
    message: e.message,
    timestamp: e.timestamp,
    statusCode: e.statusCode,
    url: e.url,
  }));

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
    finalUrl,
    scanTime,
    ...(mainResponseStatus && { statusCode: mainResponseStatus }),
    consoleErrors,
    resourceWarnings,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Results written to ${outputPath}`);
})();
