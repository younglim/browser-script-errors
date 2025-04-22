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

async function getModifiedUserAgentContext({ headless = true, devtools = false } = {}) {
  // Step 1: Get default UA using a temp context
  const tempBrowser = await chromium.launch();
  const tempContext = await tempBrowser.newContext();
  const tempPage = await tempContext.newPage();
  const defaultUA = await tempPage.evaluate(() => navigator.userAgent);
  await tempBrowser.close();

  // Step 2: Modify UA if it includes HeadlessChrome
  const modifiedUA = defaultUA.includes('HeadlessChrome')
    ? defaultUA.replace('HeadlessChrome', 'Chrome')
    : defaultUA;

  // Step 3: Launch browser with devtools/headless settings
  const browser = await chromium.launch({ headless, devtools });

  // Step 4: Create a context with the modified UA
  const context = await browser.newContext({ userAgent: modifiedUA });

  return { browser, context, userAgent: modifiedUA };
}

(async () => {
  const urlToScan = process.argv[2];
  if (!urlToScan) {
    console.error('Usage: node main.js <url>');
    process.exit(1);
  }

  const args = process.argv.slice(2); // [urlToScan, arg3?, arg4?]

  // Defaults
  let isHeadless = true;
  let timeout = 10000;

  for (const arg of args.slice(1)) { // Skip URL
    if (/^headless=false$/i.test(arg)) {
      isHeadless = false;
    } else if (/^timeout=\d+$/.test(arg)) {
      timeout = parseInt(arg.split('=')[1], 10);
    }
  }

  const { browser, context } = await getModifiedUserAgentContext({
    headless: isHeadless,
    devtools: !isHeadless,
  });

  const page = await context.newPage();

  const consoleErrorsArr = [];
  const resourceErrorsArr = [];
  const scanTime = getISOTime();

  let finalUrl = urlToScan;
  let mainResponseStatus = 'unknown';
  let lastMainFrameResponse = null;

  // Buffer all errors and warnings (filter later)
  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error') {
      const loc = msg.location(); // { url, lineNumber, columnNumber }
  
      consoleErrorsArr.push({
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
      consoleErrorsArr.push({
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

    if (status >= 400) {
      resourceErrorsArr.push({
        type: 'resourceResponseError',
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

      const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeout }).catch(() => null);
      await Promise.race([nav, page.waitForTimeout(timeout)]);

      if (finalUrl === previousUrl) break;
    }

    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    mainResponseStatus = lastMainFrameResponse?.status()?.toString() || 'unknown';
    console.log(`Resolved final URL: ${finalUrl} (status: ${mainResponseStatus})`);

  } catch (err) {
    consoleErrorsArr.push({
      type: 'navigationError',
      message: err.message,
      timestamp: getISOTime(),
      url: finalUrl,
    });
  }

  await browser.close();

  // Only include errors matching final origin
  const finalOrigin = new URL(finalUrl).origin;
  const consoleErrors = consoleErrorsArr.filter(e => new URL(e.url).origin === finalOrigin).map(e => {
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

  const resourceErrors = resourceErrorsArr.filter(e => new URL(e.url).origin === finalOrigin).map(e => ({
    errorType: e.type,
    location: e.location,
    line: e.line,
    message: e.message,
    timestamp: e.timestamp,
    ...(e.statusCode && { statusCode: e.statusCode }),
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
    resourceErrors,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Results written to ${outputPath}`);
})();
