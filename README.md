# browser-script-errors
Checks for browser resource errors when accessing websites

## How to install

```
npm install
npx playwright install
```

## How to run

```
node main.js https://<your website> headless=false timeout=2000
```
- where headless sets the browser context
- where timeout in milliseconds to wait for page events and redirects

## Sample file output 
Writes to `./results/<domain>---<timestamp>.json`

```
{
  "url": "https://example.com",
  "finalUrl": "https://example.com/",
  "scanTime": "2025-04-22T09:22:38.786Z",
  "statusCode": "200",
  "consoleErrors": [
    {
      "errorType": "error",
      "location": "https://example.com/api/user",
      "line": 0,
      "message": "Failed to load resource: the server responded with a status of 401 ()",
      "timestamp": "2025-04-22T09:22:39.941Z",
      "url": "https://example.com/"
    },
    {
      "errorType": "warning",
      "location": "https://example.com/static/index.js",
      "line": 1569,
      "message": "some console error",
      "timestamp": "2025-04-22T09:22:39.942Z",
      "url": "https://example.com/"
    }
  ],
  "resourceWarnings": [
    {
      "warningType": "resourceResponseWarning",
      "message": "https://example.com/api/user - Status: 401",
      "timestamp": "2025-04-22T09:22:39.941Z",
      "statusCode": "401",
      "url": "https://example.com/api/user"
    }
  ]
}

```
