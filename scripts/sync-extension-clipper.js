#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const sourcePath = path.resolve(__dirname, "..", "core", "x-clipper.js");
const destinationPath = path.resolve(__dirname, "..", "chrome-extension", "x-clipper.js");

fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
fs.copyFileSync(sourcePath, destinationPath);

process.stdout.write(`[sync-extension-clipper] copied ${sourcePath} -> ${destinationPath}\n`);
