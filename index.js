#!/usr/bin/env node
"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
exports.__esModule = true;
var tsquery_1 = require("@phenomnomnominal/tsquery");
var babel = require('@babel/core');
var fs_extra_1 = __importDefault(require("fs-extra"));
var find_1 = __importDefault(require("find"));
var lodash_1 = __importDefault(require("lodash"));
var yargs_1 = __importDefault(require("yargs"));
var chalk_1 = __importDefault(require("chalk"));
var typescript_1 = __importDefault(require("typescript"));
var path = require('path');
var normalizeWhitespace = require('normalize-html-whitespace');
function log() {
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    console.log.apply(console, args);
}
function logError() {
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    console.error.apply(console, args);
}
function extractTextContentFromElementDeclaration(element, indexRef, isNotTrans) {
    if (!indexRef) {
        indexRef = { current: 0 };
    }
    var index = indexRef.current;
    var content = element
        .getChildAt(1)
        .getChildren()
        .map(function (child) {
        if (child.kind === 11) {
            // JsxText
            indexRef.current++;
            return normalizeWhitespace(child.getFullText());
        }
        else if (child.kind === 274) {
            // JsxExpression
            indexRef.current++;
            return normalizeWhitespace(child.getFullText());
        }
        else if (child.kind === 264) {
            // JsxElement
            return extractTextContentFromElementDeclaration(child, indexRef, true);
        }
        logError('Unexpected Node ', child.kind, child.getFullText());
        return '';
    })
        .join('');
    if (isNotTrans) {
        return "<" + index + ">" + content.trim() + "</" + index + ">";
    }
    else {
        return content.trim();
    }
}
function extractI18nFromFile(path) {
    var keys = {};
    var ast = tsquery_1.tsquery.ast(String(fs_extra_1["default"].readFileSync(path)), path, typescript_1["default"].ScriptKind.TSX);
    var tCalls = tsquery_1.tsquery.query(ast, 'CallExpression > Identifier[name="t"]');
    function addKey(key, value, stripValueCommas) {
        key = key.slice(1, -1);
        if (stripValueCommas) {
            value = value && value.slice(1, -1);
        }
        if (keys[key] && keys[key] !== value) {
            logError("Found mismatching values for key=" + key);
        }
        keys[key] = value;
    }
    tCalls.forEach(function (tCall) {
        var children = tCall.parent.getChildren();
        var tArgs = children[2];
        if (tArgs.getChildCount() > 1) {
            var i18nKey = tArgs.getChildAt(0).getText();
            var defaultValue = void 0;
            if (tArgs.getChildAt(2).kind !== 192 /* ObjectLiteralExpression */) {
                defaultValue = tArgs.getChildAt(2).getText();
            }
            addKey(i18nKey, defaultValue, true);
        }
        else {
            var i18nKey = tArgs.getText();
            addKey(i18nKey, i18nKey, true);
        }
    });
    var transInstances = tsquery_1.tsquery
        .query(ast, 'JsxElement > JsxOpeningElement > Identifier[escapedText="Trans"]')
        .map(function (node) { return node.parent.parent; });
    transInstances.forEach(function (transInstance) {
        var _a;
        var i18nKeyPropNode = (_a = tsquery_1.tsquery.query(transInstance, 'JsxAttribute Identifier[escapedText="i18nKey"]')[0]) === null || _a === void 0 ? void 0 : _a.parent;
        var defaultValue = extractTextContentFromElementDeclaration(transInstance);
        var i18nKey = i18nKeyPropNode
            ? tsquery_1.tsquery(i18nKeyPropNode, 'StringLiteral')[0].getText()
            : "\"" + defaultValue + "\"";
        addKey(i18nKey, defaultValue, false);
    });
    return keys;
}
function main() {
    var argv = yargs_1["default"].argv;
    if (!argv.translationPath) {
        logError('Provide a translation file using the --translation-path flag');
        return;
    }
    if (!argv.sourcePath) {
        logError('Provide a source path --source-path flag');
        return;
    }
    var translationFile = require(path.join(process.cwd(), argv.translationPath));
    var sourcePath = path.join(process.cwd(), argv.sourcePath);
    var paths = find_1["default"].fileSync(/\.(js|jsx|ts|tsx)$/, sourcePath);
    var allKeysFromCode = paths.reduce(function (prev, path) {
        var keys = extractI18nFromFile(path);
        return __assign(__assign({}, prev), keys);
    }, {});
    if (argv.verbose) {
        log(allKeysFromCode);
    }
    var mismatches = [];
    Object.keys(allKeysFromCode).forEach(function (key) {
        var currentValue = lodash_1["default"].get(translationFile, key);
        if ((allKeysFromCode[key] && currentValue !== allKeysFromCode[key]) ||
            currentValue === undefined) {
            mismatches.push(key);
        }
    });
    log(chalk_1["default"].bold("compare-i18n"));
    function logValue(value, colorFunc, source) {
        if (value === undefined) {
            log("  " + source + ": " + chalk_1["default"].grey('undefined'));
        }
        else {
            log("  " + source + ": " + colorFunc(value));
        }
    }
    if (mismatches.length) {
        log("Found " + chalk_1["default"].magenta(mismatches.length) + " new/modified keys:\n");
        mismatches.forEach(function (key) {
            log(key);
            var translationValue = lodash_1["default"].get(translationFile, key);
            logValue(translationValue, chalk_1["default"].red, 'in-json');
            logValue(allKeysFromCode[key], chalk_1["default"].green, 'in-code');
            log('');
        });
    }
    else {
        console.log('No keys added/modified');
    }
    console.log('');
}
main();
