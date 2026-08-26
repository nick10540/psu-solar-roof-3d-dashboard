<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/1da6f7c8-5321-4d7d-a984-dfacd9fa4b01

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Run with Docker

The dashboard is a fully client-side SPA (SolarEdge is called straight from
the browser, building data lives in `localStorage`), so the container is
just a static file server - no API keys or env vars needed at build or run
time.

```bash
docker compose up -d --build
```

Then open http://localhost:3001. Stop it with `docker compose down`.
