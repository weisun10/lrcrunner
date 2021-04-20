#!/usr/bin/env node

/*
 * #© Copyright 2021 - Micro Focus or one of its affiliates
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
const winston = require('winston');
const { URL } = require('url');
const { program } = require('commander');
const Client = require('./lib/Client');

const RUN_POLLING_INTERVAL = 20 * 1000;
const REPORT_POLLING_INTERVAL = 20 * 1000;
const MAX_RETRIES_COUNT = 3;

program.version('1.0.0', '-v, --version', 'print version');
program.description('test executor for LoadRunner Cloud')
  .option('-r, --run [config file]', 'run with specified configuration file', '')
  .option('-u, --url [url]', 'LRC url')
  .option('-i, --client_id [client id]', 'LRC client id')
  .option('-s, --client_secret [client secret]', 'LRC client secret');
program.parse(process.argv);

const options = program.opts();

const createLogger = () => {
  const {
    combine, timestamp, printf,
  } = winston.format;

  return winston.createLogger({
    format: combine(
      timestamp(),
      printf(({
        // eslint-disable-next-line no-shadow
        level, message, timestamp,
      }) => `${timestamp} - ${level}: ${message}`),
    ),
    transports: [new winston.transports.Console()],
  });
};

const logger = createLogger();

const getRunStatusAndResultReport = async (runId, downloadReport, reportType, client, artifacts_folder) => {
  let isNeedReLogin = false;
  let isNeedRetry = false;
  let retriesCount = 0;
  do {
    try {
      if (client.credentials && isNeedReLogin) {
        // eslint-disable-next-line no-await-in-loop
        await client.authClient(client.credentials);
      }
      // eslint-disable-next-line no-await-in-loop
      await client.getTestRunStatusPolling(runId, RUN_POLLING_INTERVAL);
      if (!downloadReport || !reportType) {
        return null;
      }
      logger.info(`preparing report (${reportType}) ...`);
      const resultPath = path.join(artifacts_folder, `./results_run_#${runId}.${reportType}`);
      // eslint-disable-next-line no-await-in-loop
      const report = await client.createTestRunReport(runId, reportType);
      if (_.isSafeInteger(_.get(report, 'reportId'))) {
        // eslint-disable-next-line no-await-in-loop
        await client.getTestRunReportPolling(resultPath, report.reportId, REPORT_POLLING_INTERVAL);
      } else {
        logger.info('report is not available');
      }
      isNeedRetry = false;
    } catch (err) {
      logger.info(err.message);
      if (retriesCount < MAX_RETRIES_COUNT && err.statusCode === 401) {
        isNeedReLogin = true;
        isNeedRetry = true;
        retriesCount += 1;
      } else {
        throw err;
      }
    }
  } while (isNeedRetry);
  return null;
};

Promise.resolve().then(async () => {
  const isLocalTesting = !_.isEmpty(process.env.LRC_LOCAL_TESTING);

  const configFile = options.run;
  if (_.isEmpty(configFile)) {
    throw new Error('configuration file is missing');
  }

  logger.info(`config file: ${configFile}`);

  const configFileData = await fs.promises.readFile(configFile, 'utf8');
  const config = yaml.load(configFileData);

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

  if (!isLocalTesting) {
    if (_.isEmpty(client_id) || _.isEmpty(client_secret)) {
      throw new Error('API access keys are missing');
    }
  }

  const lrcCfg = config.modules.lrc;

  let lrcUrl = options.url || lrcCfg.url;
  if (_.isEmpty(lrcUrl)) {
    if (isLocalTesting) {
      lrcUrl = 'http://127.0.0.1:3030';
    } else {
      lrcUrl = 'https://loadrunner-cloud.saas.microfocus.com';
    }
  }

  let lrcURLObject;
  try {
    lrcURLObject = new URL(lrcUrl);

    if (isLocalTesting) {
      if (lrcURLObject.port === '3030') {
        lrcURLObject.port = '3032';
      }
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
    name,
    runTest,
    detach,
    downloadReport,
    settings,
    reportType,
  } = testOpts;

  if (!testId && _.isEmpty(name)) {
    throw new Error('test name is missing');
  }

  if (testId) {
    if (!_.isInteger(testId) || testId < 1) {
      throw new Error('invalid testId');
    }
  }

  const client = new Client(lrcCfg.tenant, lrcURLObject, proxy, logger);
  if (!isLocalTesting) {
    await client.authClient({ client_id, client_secret });
  }

  if (testId) {
    logger.info(`test id: ${testId}`);

    // process #1: run existing test
    const test = await client.getTest(projectId, testId);
    if (test && test.id === testId) {
      logger.info(`running test "${test.name}" ...`);
      const run = await client.runTest(projectId, testId);
      logger.info(`run id: ${run.runId}`);
      await getRunStatusAndResultReport(run.runId, downloadReport, reportType, client, artifacts_folder);
    } else {
      logger.error(`test ${testId} does not exist in project ${projectId}`);
    }
  } else {
    // process #2: create new test

    let { scripts } = testOpts;
    if (_.isEmpty(scripts)) {
      scripts = testOpts.script;
    }

    if (!_.isArray(scripts) || scripts.length <= 0) {
      throw new Error('script is required');
    }

    // create test
    logger.info(`going to create test: ${name}`);
    const newTest = await client.createTest(projectId, { name });
    logger.info(`created test. id: ${newTest.id}, name: ${newTest.name}`);

    // test settings
    if (settings) {
      logger.info('retrieving test settings');
      const newTestSettings = await client.getTestSettings(projectId, newTest.id);
      logger.info('updating test settings');
      await client.updateTestSettings(projectId, newTest.id, _.merge(newTestSettings, settings));
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
        logger.info('"detach" flag is enabled. exit');
        return;
      }
      await getRunStatusAndResultReport(run.runId, downloadReport, reportType, client, artifacts_folder);
    } else {
      logger.info('"runTest" flag is not enabled. exit');
    }
  }
}).catch((err) => {
  logger.error(err.toString());
  process.exit(1);
});
