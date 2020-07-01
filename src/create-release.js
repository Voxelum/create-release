const core = require('@actions/core');
const { GitHub, context } = require('@actions/github');
const fs = require('fs');
const path = require('path');
const ft = require('file-type');
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

    const getReleaseResponse = await github.repos.getReleaseByTag({ tag: tagName });

    let uploadUrl = '';

    if (getReleaseResponse.status === 404) {
      // Create a release
      // API Documentation: https://developer.github.com/v3/repos/releases/#create-a-release
      // Octokit Documentation: https://octokit.github.io/rest.js/#octokit-routes-repos-create-release
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

      // Get the ID, html_url, and upload URL for the created Release from the response
      // const {
      //   data: { id: releaseId, html_url: htmlUrl, upload_url }
      // } = createReleaseResponse;

      uploadUrl = createReleaseResponse.upload_url;

      // Set the output variables for use by other actions: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
    } else {
      const { data: { id: releaseId, html_url: htmlUrl, upload_url } } = getReleaseResponse;
      await github.repos.updateRelease({
        releaseId,
        owner,
        repo,
        tag_name: tag,
        name: releaseName,
        body,
        draft,
        prerelease,
        target_commitish: commitish
      });

      uploadUrl = upload_url;
    }


    if (fs.statSync(assetPath).isDirectory()) {
      const assets = fs.readdirSync(assetPath);
      await Promise.all(
        assets.map(async asset => {
          const subAssetPath = path.join(assetPath, asset);
          if (fs.statSync(subAssetPath).isDirectory()) {
            return;
          }
          const buff = readFile(subAssetPath);
          const fileType = await ft.fromBuffer(buff);
          const headers = {
            'content-type': fileType
              ? fileType.mime
              : path.extname(asset)
                ? `application/${path.extname(asset)}`
              : 'text/plain',
            'content-length': buff.length
          };
          await github.repos.uploadReleaseAsset({
            url: uploadUrl,
            headers,
            name: asset,
            file: buff
          });
        })
      );
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

module.exports = run;
