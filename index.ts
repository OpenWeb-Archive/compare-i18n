#!/usr/bin/env node

import { tsquery } from '@phenomnomnominal/tsquery';
const babel = require('@babel/core');
import fs from 'fs-extra';
import find from 'find';
import _ from 'lodash';
import yargs from 'yargs';
import chalk from 'chalk';
import ts from 'typescript';
const path = require('path');
const normalizeWhitespace = require('normalize-html-whitespace');

function log(...args) {
  console.log(...args);
}

function logError(...args) {
  console.error(...args);
}

function extractTextContentFromElementDeclaration(
  element: ts.Node,
  indexRef?: { current: number },
  isNotTrans?: boolean
) {
  if (!indexRef) {
    indexRef = { current: 0 };
  }
  const index = indexRef.current;

  const content = element
    .getChildAt(1)
    .getChildren()
    .map(child => {
      if (child.kind === 11) {
        // JsxText
        indexRef!.current++;
        return normalizeWhitespace(child.getFullText());
      } else if (child.kind === 274) {
        // JsxExpression
        indexRef!.current++;
        return normalizeWhitespace(child.getFullText());
      } else if (child.kind === 264) {
        // JsxElement
        return extractTextContentFromElementDeclaration(child, indexRef, true);
      }
      logError('Unexpected Node ', child.kind, child.getFullText());
      return '';
    })
    .join('');

  if (isNotTrans) {
    return `<${index}>${content.trim()}</${index}>`;
  } else {
    return content.trim();
  }
}

function extractI18nFromFile(path: string) {
  const keys = {};

  const ast = tsquery.ast(
    String(fs.readFileSync(path)),
    path,
    ts.ScriptKind.TSX
  );

  const tCalls = tsquery.query(ast, 'CallExpression > Identifier[name="t"]');

  function addKey(key: string, value?: string, stripValueCommas?: boolean) {
    key = key.slice(1, -1);
    if (stripValueCommas) {
      value = value && value.slice(1, -1);
    }
    if (keys[key] && keys[key] !== value) {
      logError(`Found mismatching values for key=${key}`);
    }
    keys[key] = value;
  }

  tCalls.forEach(tCall => {
    const children = tCall.parent.getChildren();
    const tArgs = children[2];
    if (tArgs.getChildCount() > 1) {
      const i18nKey = tArgs.getChildAt(0).getText();
      let defaultValue;
      if (tArgs.getChildAt(2).kind !== 192 /* ObjectLiteralExpression */) {
        defaultValue = tArgs.getChildAt(2).getText();
      }
      addKey(i18nKey, defaultValue, true);
    } else {
      const i18nKey = tArgs.getText();
      addKey(i18nKey, i18nKey, true);
    }
  });

  const transInstances = tsquery
    .query(
      ast,
      'JsxElement > JsxOpeningElement > Identifier[escapedText="Trans"]'
    )
    .map(node => node.parent.parent);

  transInstances.forEach(transInstance => {
    const i18nKeyPropNode = tsquery.query(
      transInstance,
      'JsxAttribute Identifier[escapedText="i18nKey"]'
    )[0]?.parent;

    const defaultValue = extractTextContentFromElementDeclaration(
      transInstance
    );

    const i18nKey = i18nKeyPropNode
      ? tsquery(i18nKeyPropNode, 'StringLiteral')[0].getText()
      : `"${defaultValue}"`;

    addKey(i18nKey, defaultValue, false);
  });

  return keys;
}

function main() {
  const argv = yargs.argv;

  if (!argv.translationPath) {
    logError('Provide a translation file using the --translation-path flag');
    return;
  }

  if (!argv.sourcePath) {
    logError('Provide a source path --source-path flag');
    return;
  }

  const translationFile = require(path.join(
    process.cwd(),
    argv.translationPath as string
  ));
  const sourcePath = path.join(process.cwd(), argv.sourcePath);

  const paths: string[] = find.fileSync(/\.(js|jsx|ts|tsx)$/, sourcePath);

  const allKeysFromCode = paths.reduce((prev, path) => {
    const keys = extractI18nFromFile(path);

    return { ...prev, ...keys };
  }, {});

  if (argv.verbose) {
    log(allKeysFromCode);
  }

  const mismatches: string[] = [];

  Object.keys(allKeysFromCode).forEach(key => {
    const currentValue = _.get(translationFile, key);
    if (
      (allKeysFromCode[key] && currentValue !== allKeysFromCode[key]) ||
      currentValue === undefined
    ) {
      mismatches.push(key);
    }
  });

  log(chalk.bold(`compare-i18n`));

  function logValue(value: string, colorFunc: chalk.Chalk, source: string) {
    if (value === undefined) {
      log(`  ${source}: ${chalk.grey('undefined')}`);
    } else {
      log(`  ${source}: ${colorFunc(value)}`);
    }
  }

  if (mismatches.length) {
    log(`Found ${chalk.magenta(mismatches.length)} new/modified keys:\n`);

    mismatches.forEach(key => {
      log(key);
      const translationValue = _.get(translationFile, key);
      logValue(translationValue, chalk.red, 'json');
      logValue(allKeysFromCode[key], chalk.green, 'code');
      log('');
    });
  } else {
    log('No keys added/modified');
  }

  log('');
}

main();
