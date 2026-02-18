#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const sourcePath = path.resolve(__dirname, "..", "core", "x-clipper.js");
const source = fs.readFileSync(sourcePath, "utf8").trim();
const bookmarklet = `javascript:${encodeURIComponent(source)}`;

process.stdout.write(`${bookmarklet}\n`);
