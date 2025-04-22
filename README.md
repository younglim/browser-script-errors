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
