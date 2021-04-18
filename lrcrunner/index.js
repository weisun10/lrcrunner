#!/usr/bin/env node

/*
 * #© Copyright 2020 - Micro Focus or one of its affiliates
 * #
 * # The only warranties for products and services of Micro Focus and its affiliates and licensors (“Micro Focus”)
 * # are as may be set forth in the express warranty statements accompanying such products and services.
 * # Nothing herein should be construed as constituting an additional warranty.
 * # Micro Focus shall not be liable for technical or editorial errors or omissions contained herein.
 * # The information contained herein is subject to change without notice.
 *
 */

const yaml = require('js-yaml');
const fs = require('fs-extra');
const path = require('path');
const _ = require('lodash');
const { URL } = require('url');
const { program } = require('commander');
const Client = require('./lib/Client');

const RUN_POLLING_INTERVAL = 15 * 1000;
const REPORT_POLLING_INTERVAL = 10 * 1000;

program.version('1.0.0', '-v, --version', 'print version');
program.option('-r, --run <config file>', 'execute test with specified config file', '')
  .option('-u, --url <url>', 'LRC url')
  .option('-i, --client_id <client id>', 'LRC client id')
  .option('-s, --client_secret <client secret>', 'LRC client secret');
program.parse(process.argv);

const options = program.opts();
const logger = console;

Promise.resolve().then(async () => {
  // logger.info(`options: ${JSON.stringify(options)}`);

  let configFile;
  if (options.run) {
    if (_.isEmpty(options.run)) {
      configFile = process.env.LRC_TEST_CONFIG;
    } else {
      configFile = options.run;
    }
  }

  logger.info(`config file: ${configFile}`);

  const ymlFileData = await fs.promises.readFile(configFile, 'utf8');
  const config = yaml.load(ymlFileData);

  // logger.info(`config data: ${JSON.stringify(config)}`);

  if (_.isEmpty(config.modules) || _.isEmpty(config.modules.lrc)) {
    throw new Error('invalid configuration file: lrc module is missing');
  }

  if (!_.isArray(config.execution) || (config.execution.length === 0) || (config.execution[0].executor !== 'lrc')) {
    throw new Error('invalid configuration file: lrc executor is missing');
  }

  const scenarioName = config.execution[0].scenario;
  if (_.isEmpty(scenarioName)) {
    throw new Error('invalid configuration file: scenario is missing');
  }

  logger.info(`scenario name: ${scenarioName}`);

  const testOpts = _.get(config, ['scenarios', scenarioName]);
  if (!_.isObject(testOpts)) {
    throw new Error(`no information for scenario: ${scenarioName}`);
  }

  const client_id = options.client_id || process.env.LRC_CLIENT_ID;
  const client_secret = options.client_secret || process.env.LRC_CLIENT_SECRET;

  if (_.isEmpty(client_id) || _.isEmpty(client_secret)) {
    throw new Error('API access keys are missing');
  }

  const lrcCfg = config.modules.lrc;

  let lrcUrl = options.url || lrcCfg.url;
  if (_.isEmpty(lrcUrl)) {
    lrcUrl = 'https://loadrunner-cloud.saas.microfocus.com';
  }

  let lrcURLObject;
  try {
    lrcURLObject = new URL(lrcUrl);
    if (lrcURLObject.port === '3030') {
      lrcURLObject.port = '3032';
    }
  } catch (ex) {
    throw new Error('invalid LRC url');
  }

  if (_.isEmpty(lrcCfg.tenant) && !_.isInteger(lrcCfg.tenant)) {
    throw new Error('tenant is missing');
  }

  const artifacts_folder = path.resolve(process.env.LRC_ARTIFACTS_FOLDER || './results');
  logger.info(`artifacts folder: ${artifacts_folder}`);
  await fs.ensureDir(artifacts_folder);

  let proxy;
  if (config.settings && config.settings.proxy && _.isString(config.settings.proxy.address)) {
    proxy = config.settings.proxy.address;
    logger.info(`proxy: ${proxy}`);
  }

  logger.info(`LRC url: ${lrcUrl}, tenant: ${lrcCfg.tenant}, client id: ${client_id}`);

  let { projectId } = testOpts;
  if (!projectId) {
    logger.info('project id is not specified, use default project 1');
    projectId = 1;
  }
  if (!_.isInteger(projectId) || projectId < 1) {
    throw new Error('invalid projectId');
  }

  logger.info(`project id: ${projectId}`);

  const {
    testId,
    testName,
    runTest,
    detach,
    downloadReport,
    testSettings,
    reportType,
    scripts,
  } = testOpts;

  if (!testId && _.isEmpty(testName)) {
    throw new Error('test name is missing');
  }

  if (testId) {
    if (!_.isInteger(testId) || testId < 1) {
      throw new Error('invalid testId');
    }
  }

  const client = new Client(lrcCfg.tenant, lrcURLObject, proxy, logger);
  if (process.env.NODE_ENV !== 'development') {
    await client.authClient({ client_id, client_secret });
  }

  if (testId) {
    logger.info(`test id: ${testId}`);

    // process #1: run exists test
    const test = await client.getTest(projectId, testId);
    if (test && test.id === testId) {
      logger.info(`running test "${test.name}" ...`);
      const run = await client.runTest(projectId, testId);
      logger.info(`run id: ${run.runId}`);
      await client.getTestRunStatusPolling(run.runId, RUN_POLLING_INTERVAL);

      if (downloadReport && reportType) {
        logger.info(`preparing report (${reportType}) ...`);
        setTimeout(async () => {
          const resultPath = path.join(artifacts_folder, `./results (run #${run.runId} of ${test.name}).${reportType}`);
          const report = await client.createTestRunReport(run.runId, reportType);
          if (_.isSafeInteger(report.reportId)) {
            await client.getTestRunReportPolling(resultPath, report.reportId, REPORT_POLLING_INTERVAL);
          } else {
            logger.info('report is not available');
          }
        }, REPORT_POLLING_INTERVAL);
      }
    } else {
      logger.error(`test ${testId} does not exist in project ${projectId}`);
    }
  } else {
    // process #2: create new test
    if (!_.isArray(scripts) || scripts.length <= 0) {
      throw new Error('script is required');
    }

    // create test
    logger.info(`going to create test: ${testName}`);
    const newTest = await client.createTest(projectId, { name: testName });
    logger.info(`created test. id: ${newTest.id}, name: ${newTest.name}`);

    // test settings
    if (testSettings) {
      logger.info('retrieving test settings');
      const newTestSettings = await client.getTestSettings(projectId, newTest.id);
      logger.info('updating test settings');
      await client.updateTestSettings(projectId, newTest.id, _.merge(newTestSettings, testSettings));
    }

    // test scripts
    logger.info('going to create scripts');

    // eslint-disable-next-line no-restricted-syntax
    for await (const script of scripts) {
      logger.info(`uploading script: ${script.path} ...`);
      const newScript = await client.uploadScript(projectId, script.path);
      logger.info(`uploaded script. id: ${newScript.id}`);
      const testScript = await client.addTestScript(projectId, newTest.id, { scriptId: newScript.id });
      logger.info('added script into test');
      testScript.loadTestScriptId = testScript.id;
      await client.updateTestScript(projectId, newTest.id, _.merge(testScript, script));
      logger.info('updated test script settings');
    }

    let { distributions, loadGenerators } = testOpts || {};
    // vuser distributions
    if (!_.every(scripts, (script) => script.locationType === 1)) { // 0: Cloud; 1: On-Premise
      const testLocations = await client.getTestDistributionLocations(projectId, newTest.id);
      distributions = distributions || [];
      // eslint-disable-next-line no-restricted-syntax
      for await (const distribution of distributions) {
        const { locationName, vusersPercent } = distribution;
        const currLocation = _.find(testLocations, { name: locationName });
        if (currLocation) {
          await client.updateTestDistributionLocation(projectId, newTest.id, currLocation.id, { vusersPercent });
          logger.info(`updated vuser distributions (${locationName}) - ${vusersPercent}`);
        } else {
          throw new Error(`location "${locationName}" does not exist`);
        }
      }
    }

    if (_.find(scripts, (script) => script.locationType === 1)) { // 0: Cloud; 1: On-Premise
      const projectLoadGenerators = await client.getLoadGenerators(projectId) || [];
      loadGenerators = loadGenerators || [];
      // eslint-disable-next-line no-restricted-syntax
      for await (const lgKey of loadGenerators) {
        const currLg = _.find(projectLoadGenerators, (projectLg) => projectLg.key === lgKey);
        if (currLg) {
          await client.assignLgToTest(projectId, newTest.id, currLg.id);
          logger.info(`assigned load generator "${lgKey}" to test`);
        } else {
          throw new Error(`load generator "${lgKey}" does not exist`);
        }
      }
    }

    if (runTest) {
      logger.info(`running test ${newTest.name} ...`);
      const run = await client.runTest(projectId, newTest.id);
      logger.info(`run id: ${run.runId}`);
      if (detach) {
        logger.info('detach flag is enabled. exit');
        return;
      }
      await client.getTestRunStatusPolling(run.runId, RUN_POLLING_INTERVAL);

      if (downloadReport && reportType) {
        logger.info(`preparing report (${reportType}) ...`);
        setTimeout(async () => {
          const resultPath = path.join(artifacts_folder, `./results (run #${run.runId} of ${testName}).${reportType}`);
          const report = await client.createTestRunReport(run.runId, reportType);
          if (_.isSafeInteger(report.reportId)) {
            await client.getTestRunReportPolling(resultPath, report.reportId, REPORT_POLLING_INTERVAL);
          } else {
            logger.info('report is not available');
          }
        }, REPORT_POLLING_INTERVAL);
      }
    }
  }
}).catch((err) => {
  logger.error(err.toString());
  process.exit(1);
});
