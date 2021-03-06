const core = require('@actions/core');
const { GitHub, context } = require('@actions/github');
const fs = require('fs');
const path = require('path');
const util = require('util');

const readFile = util.promisify(fs.readFile);

async function run() {
  try {
    // Get authenticated GitHub client (Ocktokit): https://github.com/actions/toolkit/tree/master/packages/github#usage
    const github = new GitHub(process.env.GITHUB_TOKEN);

    // Get owner and repo from context of payload that triggered the action
    const { owner, repo } = context.repo;

    // Get the inputs from the workflow file: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
    const tagName = core.getInput('tag_name', { required: true });

    // This removes the 'refs/tags' portion of the string, i.e. from 'refs/tags/v1.10.15' to 'v1.10.15'
    const tag = tagName.replace('refs/tags/', '');
    const releaseName = core.getInput('release_name', { required: false }).replace('refs/tags/', '');
    const body = core.getInput('body', { required: false });
    const draft = core.getInput('draft', { required: false }) === 'true';
    const prerelease = core.getInput('prerelease', { required: false }) === 'true';
    const commitish = core.getInput('commitish', { required: false }) || context.sha;
    const assetPath = core.getInput('asset_dir_path', { required: true });

    let uploadUrl = '';

    const listReleaseResponse = await github.repos.listReleases({ owner, repo });
    const draftRelease = listReleaseResponse.data.find(r => r.draft);

    if (draftRelease) {
      await github.repos.updateRelease({
        release_id: draftRelease.id,
        owner,
        repo,
        tag_name: tag,
        name: releaseName,
        body,
        draft,
        prerelease,
        target_commitish: commitish
      });

      uploadUrl = draftRelease.upload_url;
    } else {
      const createReleaseResponse = await github.repos.createRelease({
        owner,
        repo,
        tag_name: tag,
        name: releaseName,
        body,
        draft,
        prerelease,
        target_commitish: commitish
      });

      uploadUrl = createReleaseResponse.data.upload_url;
    }

    if (assetPath && fs.statSync(assetPath).isDirectory()) {
      const assets = fs.readdirSync(assetPath);
      await Promise.all(
        assets.map(async asset => {
          const subAssetPath = path.join(assetPath, asset);
          if (fs.statSync(subAssetPath).isDirectory()) {
            return;
          }
          const buff = await readFile(subAssetPath);
          let contentType = '';
          switch (path.extname(asset)) {
            case '.exe':
            case '.deb':
            case '.AppImage':
            case '.rpm':
            case '.snap':
            case '.dmg':
            case '.pkg':
            default:
              contentType = 'application/octet-stream';
              break;
            case '.zip':
              contentType = 'application/zip';
              break;
            case '.json':
              contentType = 'application/json';
              break;
            case '.yml':
            case '.yaml':
              contentType = 'application/x-yaml';
              break;
            case '.txt':
              contentType = 'text/plain';
              break;
          }
          const headers = {
            'content-type': contentType,
            'content-length': buff.length
          };
          await github.repos.uploadReleaseAsset({
            url: uploadUrl,
            headers,
            name: asset.replace(' ', '-'),
            data: buff
          });
        })
      );
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

module.exports = run;
