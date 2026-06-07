# shotgun-notif

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.21. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Docker

Build the image:

```bash
docker build -t shotgun-notif .
```

Run with a config file mounted:

```bash
docker run -v ./config.json:/app/config.json:ro shotgun-notif
```

Or use Docker Compose:

```bash
# Create your config.json first, then:
docker compose up -d
```

The container will restart automatically unless explicitly stopped.
