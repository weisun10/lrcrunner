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

const fs = require('fs-extra');
const path = require('path');
const _ = require('lodash');
const { program } = require('commander');
const Client = require('./lib/Client');
const utils = require('./lib/utils');

program.version('1.0.0', '-v, --version', 'print version');
program.description('test executor for LoadRunner Cloud')
  .option('-r, --run [config file]', 'run with specified configuration file', '')
  .option('-u, --url [url]', 'LRC url')
  .option('-a, --artifacts [folder]', 'artifacts folder')
  .option('-i, --client_id [client id]', 'LRC client id')
  .option('-s, --client_secret [client secret]', 'LRC client secret');
program.parse(process.argv);

const logger = utils.createLogger();

const run = async () => {
  const options = program.opts();

  // load env
  const isLocalTesting = utils.isOptionEnabled(process.env.LRC_LOCAL_TESTING);
  const client_id = options.client_id || process.env.LRC_CLIENT_ID;
  const client_secret = options.client_secret || process.env.LRC_CLIENT_SECRET;
  const artifacts_folder = options.artifacts || path.resolve(process.env.LRC_ARTIFACTS_FOLDER || './results');

  if (!isLocalTesting && (_.isEmpty(client_id) || _.isEmpty(client_secret))) {
    throw new Error('API access keys are missing');
  }

  logger.info(`artifacts folder: ${artifacts_folder}`);
  await fs.ensureDir(artifacts_folder);

  // load config
  const {
    testOpts, lrcCfg, lrcURLObject, proxy,
  } = await utils.loadAndCheckConfig(options, isLocalTesting, logger);

  logger.info(`LRC url: ${lrcURLObject.href}, tenant: ${lrcCfg.tenant}, client id: ${client_id}`);

  // load test options
  const {
    projectId, testId, scripts, name, runTest, detach, downloadReport,
    settings, reportTypes, distributions, loadGenerators,
  } = await utils.loadAndCheckTestOpts(testOpts, logger);

  // start main progress
  const client = new Client(lrcCfg.tenant, lrcURLObject, proxy, logger);
  if (!isLocalTesting) {
    await client.authClient({ client_id, client_secret });
  }

  if (testId) {
    // process #1: run existing test

    logger.info(`test id: ${testId}`);
    const test = await client.getTest(projectId, testId);
    logger.info(`running test: "${test.name}" ...`);

    // run test
    const currRun = await client.runTest(projectId, testId);
    logger.info(`run id: ${currRun.runId}, url: ${utils.getDashboardUrl(lrcURLObject.href, lrcCfg.tenant, currRun.runId)}`);

    // run status and report
    await client.getRunStatusAndResultReport(currRun.runId, downloadReport, reportTypes, artifacts_folder);
  } else {
    // process #2: create new test

    // create test
    logger.info(`going to create test: ${name}`);
    const newTest = await client.createTest(projectId, { name });
    logger.info(`created test. id: ${newTest.id}, name: ${newTest.name}`);

    // test settings
    logger.info('retrieving test settings');
    const newTestSettings = await client.getTestSettings(projectId, newTest.id);
    if (!_.isEmpty(settings)) {
      logger.info('updating test settings');
      await client.updateTestSettings(projectId, newTest.id, _.merge(newTestSettings, settings));
    }

    // test scripts
    logger.info('going to create scripts');
    const allTestScripts = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const script of scripts) {
      let scriptId = script.id;
      if (!scriptId) {
        logger.info(`uploading script: ${script.path} ...`);
        const newScript = await client.uploadScript(projectId, script.path);
        logger.info(`uploaded script. id: ${newScript.id}`);
        scriptId = newScript.id;
      }

      const testScript = await client.addTestScript(projectId, newTest.id, { scriptId });
      logger.info(`added script ${scriptId} into test`);
      testScript.loadTestScriptId = testScript.id;
      const allTestScript = await client.updateTestScript(projectId, newTest.id, _.merge(testScript, script));
      allTestScripts.push(allTestScript);
      logger.info('updated test script settings');
    }

    // vuser distributions
    if (_.find(allTestScripts, (allTestScript) => allTestScript.locationType === 0)) { // exist location "Cloud"
      const testLocations = await client.getTestDistributionLocations(projectId, newTest.id);
      // eslint-disable-next-line no-restricted-syntax
      for await (const distribution of distributions) {
        const { locationName, vusersPercent } = distribution;
        const currLocation = _.find(testLocations, { name: locationName });
        if (currLocation) {
          await client.updateTestDistributionLocation(projectId, newTest.id, currLocation.id, { vusersPercent });
          logger.info(`updated vuser distribution: ${locationName} - ${vusersPercent}`);
        } else {
          throw new Error(`location "${locationName}" does not exist`);
        }
      }
    }

    // load generators
    if (_.find(allTestScripts, (allTestScript) => allTestScript.locationType === 1)) { // exist location "On-Premise"
      if (loadGenerators.length <= 0) {
        throw new Error('load generators are missing');
      }
      const projectLoadGenerators = await client.getLoadGenerators(projectId) || [];
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

    // run test
    if (!runTest) {
      logger.info('"runTest" flag is not enabled. exit');
      return;
    }
    logger.info(`running test: ${newTest.name} ...`);
    const currRun = await client.runTest(projectId, newTest.id);
    logger.info(`run id: ${currRun.runId}, url: ${utils.getDashboardUrl(lrcURLObject.href, lrcCfg.tenant, currRun.runId)}`);
    if (detach) {
      logger.info('"detach" flag is enabled. exit');
      return;
    }

    // run status and report
    await client.getRunStatusAndResultReport(currRun.runId, downloadReport, reportTypes, artifacts_folder);
  }

  logger.info('done');
};

run().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
