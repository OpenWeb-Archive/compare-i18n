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
    .getChildren()
    .slice(4)
    .map(child => {
      if (child.kind === 192) {
        // Object
        indexRef!.current++;
        return `{{${child
          .getChildren()[1]
          .getChildren()[0]
          .getChildren()[0]
          .getText()}}}`;
      } else if (child.kind === 10) {
        // String
        indexRef!.current++;
        return child.getText().slice(1, -1);
      } else if (child.kind === 195) {
        // CallExpression
        return extractTextContentFromElementDeclaration(
          child.getChildAt(2),
          indexRef,
          true
        );
      } else if (child.kind === 27) {
        // Comma
        return '';
      }
      console.error('Unexpected Node ', child.kind, child.getText());
      return '';
    })
    .join('');

  if (isNotTrans) {
    return `<${index}>${content}</${index}>`;
  } else {
    return content;
  }
}

function extractI18nFromFile(path: string, babelConfig: any) {
  const code = babel.transform((fs.readFileSync(path) as unknown) as string, {
    ...babelConfig,
    filename: path,
  })!.code!;

  const keys = {};

  const ast = tsquery.ast(code);

  const tCalls = tsquery.query(ast, 'CallExpression > Identifier[name="t"]');

  function addKey(key: string, value?: string, stripValueCommas?: boolean) {
    key = key.slice(1, -1);
    if (stripValueCommas) {
      value = value && value.slice(1, -1);
    }
    if (keys[key] && keys[key] !== value) {
      console.error(`Found mismatching values for key=${key}`);
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
      addKey(i18nKey, undefined, true);
    }
  });

  const transInstances = tsquery
    .query(
      ast,
      'CallExpression > PropertyAccessExpression > Identifier[name="Trans"]'
    )
    .filter(
      transInstance => transInstance.parent.getText() === '_reactI18next.Trans'
    );

  transInstances.forEach(transInstance => {
    const i18nKeyAssignment = tsquery.query(
      transInstance.parent.parent,
      'ObjectLiteralExpression > PropertyAssignment > Identifier[name="i18nKey"]'
    );
    const i18nKey = i18nKeyAssignment[0].parent.getChildAt(2).getText();
    const defaultValue = extractTextContentFromElementDeclaration(
      transInstance.parent.parent.getChildAt(2)
    );

    addKey(i18nKey, defaultValue, false);
  });

  return keys;
}

function main() {
  const argv = yargs.argv;

  if (!argv.translationPath) {
    console.error(
      'Provide a translation file using the --translation-path flag'
    );
    return;
  }

  if (!argv.babelConfigPath) {
    console.error(
      'Provide a babel config file using the --babel-config-path flag'
    );
    return;
  }

  if (!argv.sourcePath) {
    console.error('Provide a source path --source-path flag');
    return;
  }

  const translationFile = require(path.join(
    process.cwd(),
    argv.translationPath as string
  ));
  const babelConfig = require(path.join(
    process.cwd(),
    argv.babelConfigPath as string
  ));
  const sourcePath = path.join(process.cwd(), argv.sourcePath);

  const paths: string[] = find.fileSync(/\.(js|jsx|ts|tsx)$/, sourcePath);

  const allKeysFromCode = paths.reduce((prev, path) => {
    const keys = extractI18nFromFile(path, babelConfig);

    return { ...prev, ...keys };
  }, {});

  if (argv.verbose) {
    console.log(allKeysFromCode);
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

  console.log(chalk.bold(`compare-i18n`));

  function logValue(value: string, colorFunc: chalk.Chalk) {
    if (value === undefined) {
      console.log('  ' + chalk.grey('undefined'));
    } else {
      console.log('  ' + colorFunc(value));
    }
  }

  if (mismatches.length) {
    console.log(
      `Found ${chalk.magenta(mismatches.length)} new/modified keys:\n`
    );

    mismatches.forEach(key => {
      console.log(key);
      const translationValue = _.get(translationFile, key);
      logValue(translationValue, chalk.red);
      logValue(allKeysFromCode[key], chalk.green);
    });
  } else {
    console.log('No keys added/modified');
  }

  console.log('');
}

main();
