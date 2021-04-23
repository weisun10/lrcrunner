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

const winston = require('winston');
const yaml = require('js-yaml');
const fs = require('fs-extra');
const _ = require('lodash');
const { URL } = require('url');

const utils = {

  loadAndCheckConfig: async (options, isLocalTesting, logger) => {
    const configFile = options.run;
    if (_.isEmpty(configFile)) {
      throw new Error('configuration file is missing');
    }
    logger.info(`config file: ${configFile}`);

    const configFileData = await fs.promises.readFile(configFile, 'utf8');
    const config = yaml.load(configFileData);

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

    let proxy;
    if (config.settings && config.settings.proxy && _.isString(config.settings.proxy.address)) {
      proxy = config.settings.proxy.address;
      logger.info(`proxy: ${proxy}`);
    }

    return {
      config, testOpts, lrcCfg, lrcUrl, lrcURLObject, proxy,
    };
  },

  loadAndCheckTestOpts: async (testOpts, logger) => {
    let { projectId, scripts } = testOpts;
    if (!projectId) {
      logger.info('project id is not specified, use default project 1');
      projectId = 1;
    }
    if (!_.isInteger(projectId) || projectId < 1) {
      throw new Error('invalid projectId');
    }

    logger.info(`project id: ${projectId}`);

    const {
      testId, name, script, runTest = true, detach = false, downloadReport = true,
      settings = {}, distributions = [], loadGenerators = [],
    } = testOpts;

    if (!testId && _.isEmpty(name)) {
      throw new Error('test name is missing');
    }

    if (testId) {
      if (!_.isInteger(testId) || testId < 1) {
        throw new Error('invalid testId');
      }
    }

    let { reportType } = testOpts;
    if (_.isEmpty(reportType)) {
      reportType = 'pdf';
    }

    let reportTypes;
    if (_.isArray(reportType)) {
      reportTypes = _.uniq(reportType);
    } else {
      reportTypes = [reportType];
    }

    if (!utils.validateReportType(reportTypes)) {
      throw new Error('invalid reportType');
    }

    if (!testId) {
      if (_.isEmpty(scripts)) {
        scripts = script;
      }
      if (!_.isArray(scripts) || scripts.length <= 0) {
        throw new Error('script is required');
      }
    }

    return {
      projectId,
      testId,
      name,
      scripts,
      runTest,
      detach,
      downloadReport,
      settings,
      reportTypes,
      distributions,
      loadGenerators,
    };
  },

  isOptionEnabled: (option) => {
    if (!option) {
      return false;
    }

    const trueValues = ['true', 'yes', 'y', '1', 'enabled'];
    return trueValues.includes(option.toString().toLowerCase());
  },

  getDashboardUrl: (url, tenant, runId) => {
    const dashboardUrl = new URL(url);
    dashboardUrl.searchParams.append('TENANTID', tenant);
    dashboardUrl.pathname = `/run-overview/${runId}/dashboard/`;
    return dashboardUrl.toString();
  },

  validateReportType: (reportTypes) => {
    const TYPES = ['pdf', 'docx', 'csv'];
    return _.every(reportTypes, (type) => TYPES.includes(type));
  },

  createLogger: () => {
    const {
      combine, timestamp, printf,
    } = winston.format;

    return winston.createLogger({
      format: combine(
        timestamp(),
        printf(({
          level,
          message,
          // eslint-disable-next-line no-shadow
          timestamp,
        }) => `${timestamp} - ${level}: ${message}`),
      ),
      transports: [new winston.transports.Console()],
    });
  },

};

module.exports = utils;
