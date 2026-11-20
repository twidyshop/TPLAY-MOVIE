// Vercel Serverless Function entrypoint.
// Load the compiled Express app and explicitly register the TypeScript path alias.
const path = require("path");
const moduleAlias = require("module-alias");

moduleAlias.addAlias("@", path.join(__dirname, "..", "dist"));

// Keep axios in the function dependency trace; stream controllers use it at runtime.
require("axios");

const app = require("../dist/server").default;

module.exports = app;
