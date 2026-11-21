# BoardScout — Cloudflare Workers Deployment

BoardScout is a complete static chess assistant website. It includes the board interface, chess logic, Stockfish engine, and all styles and assets, and can be deployed directly to Cloudflare Workers with a `workers.dev` URL.

## 1. Prerequisites

Install these tools:

- [Node.js](https://nodejs.org/) 20 or newer
- [Git](https://git-scm.com/) (optional, if uploading a repository)
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)

To check Node.js:

```powershell
node --version
npm --version
```

## 2. Prepare the project

Copy the entire website folder, or download it from VS Code. Keep these files together:

- `index.html`
- `app.js`
- `styles.css`
- `arrow.css`
- `chess.min.js`
- `stockfish-11-asm.js`
- `stockfish-11.js`
- `stockfish-11.wasm`
- `stockfish-nnue-16.js`
- `stockfish-nnue-16.wasm`
- `stockfish-no-simd.js`
- `stockfish-no-simd.wasm`
- `package.json`
- `wrangler.toml`

Do not rename or separate these files. `app.js` loads the engine and assets from paths such as `/stockfish-11-asm.js`, so all files must be uploaded into the same website directory.

## 3. Install Wrangler

Open PowerShell inside the project folder and run:

```powershell
npm install
npm install --save-dev wrangler
```

If you do not want to modify `package.json`, use Wrangler directly:

```powershell
npx wrangler --version
```

## 4. Configure the Worker

The included `wrangler.toml` is already prepared:

```toml
name = "boardscout-chess-assistant"
compatibility_date = "2026-11-20"

[assets]
directory = "./"
```

The `name` becomes part of the Workers subdomain. Change it to a unique lowercase name if Cloudflare reports that it is already taken.

## 5. Sign in to Cloudflare

Run:

```powershell
npx wrangler login
```

A browser window will open. Choose your Cloudflare account and authorize Wrangler.

To confirm that Wrangler is authenticated:

```powershell
npx wrangler whoami
```

## 6. Deploy the complete website

> **Important:** Do not use the Cloudflare dashboard's **Upload files** action for this project while `.venv`, `.git`, `node_modules`, or the source project folder is present. That uploader is intended for a finished asset bundle or Pages build and may reject projects containing build folders.

From the project folder, run:

```powershell
npm run deploy
```

This runs:

```powershell
npx wrangler deploy
```

Wrangler will upload the files and print a live URL similar to:

```text
https://boardscout-chess-assistant.<your-subdomain>.workers.dev
```

Open that URL to use the website.

## 7. Preview locally before deployment

Run:

```powershell
npm run dev
```

This starts a local Cloudflare environment. Wrangler prints a local preview address, normally:

```text
http://localhost:8787
```

You can also use the included simple static server:

```powershell
npm run serve
```

## 8. Updating the website

After changing HTML, CSS, JavaScript, or engine files:

```powershell
npx wrangler deploy
```

Cloudflare replaces the deployed assets with the updated versions.

## 9. Deploy through GitHub instead

You can also connect the project with Cloudflare Workers Builds:

1. Create a GitHub repository.
2. Upload the entire project folder to the repository.
3. Open Cloudflare Dashboard → Workers & Pages.
4. Select **Create application** → **Workers**.
5. Choose **Import a repository** or connect GitHub.
6. Select the repository.
7. Set the build/deploy command to:

```text
npx wrangler deploy
```

8. Use the project root as the build directory.
9. Deploy.

Future pushes can automatically create new deployments.

## 10. Deployment details

- This project uses Cloudflare static assets. No application server or database is required.
- The Stockfish engine runs in the visitor's browser using a Web Worker.
- The website is served from the same origin as the engine, avoiding cross-origin Worker setup.
- A `workers.dev` subdomain is included free with Cloudflare Workers.
- You can later connect a custom domain from the Worker settings in the Cloudflare dashboard.

## Troubleshooting

### `npm` is not recognized

Node.js is not installed or its terminal path is not available. Install Node.js, open a new PowerShell window, and retry.

### `wrangler` is not recognized

Use:

```powershell
npx wrangler deploy
```

Or install it locally:

```powershell
npm install --save-dev wrangler
```

### A Worker name is already taken

Change `name` in `wrangler.toml`, for example:

```toml
name = "my-boardscout-website"
```

### The engine is unavailable

Confirm that `stockfish-11-asm.js` is included in the deployed folder and that `app.js` is loading it from `/stockfish-11-asm.js`. Redeploy after restoring or renaming the engine files.

### A 404 occurs after deployment

Make sure `index.html` is in the asset root used by `directory = "./"`, and redeploy from the folder containing `wrangler.toml`.
