// Vercel Serverless Function entrypoint.
// The existing Express application is compiled from src/ into dist/ during build.
require("module-alias/register");

const app = require("../dist/server").default;

module.exports = app;
