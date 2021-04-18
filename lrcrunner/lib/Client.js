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

const { URL, URLSearchParams } = require('url');
const fs = require('fs-extra');
const path = require('path');
const got = require('got');
const tunnel = require('tunnel');
const FormData = require('form-data');

const MAX_DOWNLOAD_TIME = 10 * 60000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Client {
  constructor(tenant, url, proxy, logger) {
    this.server = url;
    this.logger = logger;
    this.tenant = tenant;

    this.retries = 0;

    if (proxy) {
      const proxyUrl = new URL(proxy);
      this.proxy = {
        host: proxyUrl.hostname,
        port: proxyUrl.port,
      };
    }

    this._client = got.extend({
      handlers: [
        (options, next) => (async () => {
          const response = await next(options)
            .catch((err) => {
              if (err.response && err.response.body) {
                let currErr;
                try {
                  currErr = new Error(JSON.parse(err.response.body).message);
                } catch (e) {
                  currErr = new Error(err.response.body);
                }
                currErr.statusCode = err.response.statusCode;
                throw currErr;
              }
              throw err;
            });
          let result;
          try {
            result = JSON.parse(response.body);
          } catch (e) {
            // Better to use the response returned 401 error instead
            if ((response.body.indexOf('Sign in with corporate credentials') >= 0)
                && (response.body.indexOf('Submit your email address') >= 0)) {
              const currErr = new Error('Unauthorized');
              currErr.statusCode = 401;
              throw currErr;
            }
            result = response.body;
          }
          return result;
        })(),
      ],
    });
  }

  async checkAndRetryAuthClient(err) {
    if (err.statusCode === 401 && this.credentials && this.retries <= 3) {
      this.retries += 1;
      await this.authClient(this.credentials);
      return true;
    }
    this.retries = 0;
    return false;
  }

  getDefaultOptions() {
    const options = {
      prefixUrl: this.server,
      retry: 0,
      searchParams: new URLSearchParams(`TENANTID=${this.tenant}`),
      headers: {
        'content-type': 'application/json',
      },
      agent: {
        https: tunnel.httpsOverHttp({
          proxy: this.proxy,
        }),
      },
    };
    if (this.token) {
      options.headers.Authorization = `Bearer ${this.token}`;
    }
    return options;
  }

  async authClient(json = {}) {
    this.credentials = json;
    const opt = this.getDefaultOptions();
    opt.json = json;
    const result = await this._client.post('v1/auth-client', opt)
      .catch((err) => {
        throw new Error(`authentication failed: ${err.message}`);
      });
    this.token = result.token;
  }

  async getTest(projectId, testId) {
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/projects/${projectId}/load-tests/${testId}`, opt)
      .catch((err) => {
        throw new Error(`failed to get test: ${err.message}`);
      });
  }

  async runTest(projectId, testId) {
    const opt = this.getDefaultOptions();
    return this._client.post(`v1/projects/${projectId}/load-tests/${testId}/runs`, opt)
      .catch((err) => {
        throw new Error(`running test failed: ${err.message}`);
      });
  }

  async getTestRunStatus(runId) {
    const that = this;
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/test-runs/${runId}/status`, opt)
      .catch(async (err) => {
        if (await that.checkAndRetryAuthClient(err)) {
          return that.getTestRunStatus(runId);
        }
        throw new Error(`getting run status failed: ${err.message}`);
      });
  }

  async getTestRun(runId) {
    const that = this;
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/test-runs/${runId}`, opt)
      .catch(async (err) => {
        if (await that.checkAndRetryAuthClient(err)) {
          return that.getTestRun(runId);
        }
        throw new Error(`getting run result failed: ${err.message}`);
      });
  }

  async getTestRunStatusPolling(runId, time = 5000) {
    const that = this;
    async function polling() {
      const currStatus = await that.getTestRunStatus(runId);
      that.logger.info(currStatus.detailedStatus);

      if (currStatus.status === 'in-progress') {
        await wait(time);
        return polling();
      }
      return currStatus;
    }

    await wait(time);
    return polling();
  }

  async createTest(projectId, json) {
    const opt = this.getDefaultOptions();
    opt.json = json;
    return this._client.post(`v1/projects/${projectId}/load-tests`, opt)
      .catch((err) => {
        throw new Error(`creating test failed: ${err.message}`);
      });
  }

  async getTestSettings(projectId, testId) {
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/projects/${projectId}/load-tests/${testId}/settings`, opt)
      .catch((err) => {
        throw new Error(`getting test settings failed: ${err.message}`);
      });
  }

  async updateTestSettings(projectId, testId, json) {
    const opt = this.getDefaultOptions();
    opt.json = json;
    return this._client.put(`v1/projects/${projectId}/load-tests/${testId}/settings`, opt)
      .catch((err) => {
        throw new Error(`updating test settings failed: ${err.message}`);
      });
  }

  async uploadScript(projectId, filePath) {
    const stats = await fs.promises.stat(filePath);
    if (!stats || !stats.size) {
      throw new Error(`file '${filePath}' does not exist`);
    }
    const opt = this.getDefaultOptions();
    const form = new FormData();
    form.append('file', fs.createReadStream(path.resolve(process.cwd(), filePath)));
    opt.body = form;
    opt.headers['content-type'] = `multipart/form-data; boundary=${form.getBoundary()}`;
    return this._client.post(`v1/projects/${projectId}/scripts`, opt)
      .catch((err) => {
        throw new Error(`uploading script failed: ${err.message}`);
      });
  }

  async addTestScript(projectId, testId, json) {
    const opt = this.getDefaultOptions();
    opt.json = json;
    return this._client.post(`v1/projects/${projectId}/load-tests/${testId}/scripts`, opt)
      .catch((err) => {
        throw new Error(`adding test script failed: ${err.message}`);
      });
  }

  async updateTestScript(projectId, testId, json) {
    const opt = this.getDefaultOptions();
    opt.json = [json];
    return this._client.put(`v1/projects/${projectId}/load-tests/${testId}/scripts`, opt)
      .catch((err) => {
        throw new Error(`updating test script failed: ${err.message}`);
      });
  }

  async getTestDistributionLocations(projectId, testId) {
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/projects/${projectId}/load-tests/${testId}/locations`, opt)
      .catch((err) => {
        throw new Error(`getting test locations failed: ${err.message}`);
      });
  }

  async updateTestDistributionLocation(projectId, testId, locationId, json) {
    const opt = this.getDefaultOptions();
    opt.json = json;
    return this._client.put(`v1/projects/${projectId}/load-tests/${testId}/locations/${locationId}`, opt)
      .catch((err) => {
        throw new Error(`updating test script location failed: ${err.message}`);
      });
  }

  async getLoadGenerators(projectId) {
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/projects/${projectId}/load-generators`, opt)
      .catch((err) => {
        throw new Error(`getting load generators failed: ${err.message}`);
      });
  }

  async assignLgToTest(projectId, testId, loadGeneratorId) {
    const opt = this.getDefaultOptions();
    return this._client.put(`v1/projects/${projectId}/load-tests/${testId}/load-generators/${loadGeneratorId}`, opt)
      .catch((err) => {
        throw new Error(`assigning load generator to test failed: ${err.message}`);
      });
  }

  async createTestRunReport(runId, reportType) {
    const that = this;
    const opt = this.getDefaultOptions();
    opt.json = { reportType };
    return this._client.post(`v1/test-runs/${runId}/reports`, opt)
      .catch(async (err) => {
        if (await that.checkAndRetryAuthClient(err)) {
          return that.createTestRunReport(runId, reportType);
        }
        throw new Error(`creating run report failed: ${err.message}`);
      });
  }

  async downloadTestRunReport(fileName, reportId) {
    const that = this;

    const opt = this.getDefaultOptions();
    opt.isStream = true;
    return new Promise((resolve, reject) => {
      let isNotReturn = false;
      try {
        const downloadStream = got(`v1/test-runs/reports/${reportId}`, opt);
        const fileWriterStream = fs.createWriteStream(fileName);

        setTimeout(() => {
          downloadStream.destroy();
          fileWriterStream.destroy();
          reject(new Error('Download time exceeds 10 minutes'));
        }, MAX_DOWNLOAD_TIME);

        downloadStream
          .on('downloadProgress', ({ transferred }) => {
            that.logger.info(`downloading report ...... ${transferred} (bytes)`);
          })
          .on('error', (error) => {
            that.logger.error(`downloading failed: ${error.message}`);
            if (isNotReturn) {
              isNotReturn = false;
              return reject(error);
            }
            return null;
          });

        fileWriterStream
          .on('error', (error) => {
            that.logger.error(`failed to write file: ${error.message}`);
            if (isNotReturn) {
              isNotReturn = false;
              return reject(error);
            }
            return null;
          })
          .on('finish', () => {
            that.logger.info(`downloaded to ${fileName}`);
            if (isNotReturn) {
              isNotReturn = false;
              return resolve();
            }
            return null;
          });

        downloadStream.pipe(fileWriterStream);
      } catch (e) {
        if (isNotReturn) {
          isNotReturn = false;
          return reject(e);
        }
      }
      return null;
    })
      .catch(async (err) => {
        if (await that.checkAndRetryAuthClient(err)) {
          return that.downloadTestRunReport(fileName, reportId);
        }
        throw err;
      });
  }

  async checkTestRunReport(reportId) {
    const that = this;
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/test-runs/reports/${reportId}`, opt)
      .catch(async (err) => {
        if (await that.checkAndRetryAuthClient(err)) {
          return that.checkTestRunReport(reportId);
        }
        throw new Error(`checking run report failed: ${err.message}`);
      });
  }

  async getTestRunReportPolling(name, reportId, time = 5000) {
    const that = this;
    async function polling() {
      const currReport = await that.checkTestRunReport(reportId);
      if (currReport.message === 'In progress') {
        that.logger.info(`report (${reportId}) is not yet ready`);
        await wait(time);
        return polling();
      }
      that.logger.info('report is ready, going to download it');
      await that.downloadTestRunReport(name, reportId);
      return currReport;
    }

    await wait(time);
    return polling();
  }
}

module.exports = Client;
