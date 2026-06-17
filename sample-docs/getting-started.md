# Getting Started with Acme Cloud

Acme Cloud is a platform for deploying and scaling web applications. This guide
covers account creation, your first deployment, and basic concepts.

## Creating an account

1. Go to https://app.acme.cloud/signup
2. Enter your work email and choose a password (minimum 12 characters).
3. Confirm your email via the link we send you.
4. You will be placed on the **Free** tier by default.

## Your first deployment

After logging in, click **New Project**, connect your Git repository, and pick a
branch. Acme Cloud detects the framework automatically and builds the project.
A successful build is promoted to a production URL ending in `.acme.app`.

## Core concepts

- **Project** — a single application, linked to one Git repository.
- **Environment** — production, preview, or development. Each has its own
  variables and domains.
- **Deployment** — an immutable build of your project at a point in time.
- **Region** — the geographic location where your app runs. Default is `eu-1`.
