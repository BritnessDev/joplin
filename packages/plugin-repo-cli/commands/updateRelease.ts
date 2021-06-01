import { githubOauthToken } from '@joplin/tools/tool-utils';
import { pathExists, readdir, readFile, writeFile } from 'fs-extra';
const ghReleaseAssets = require('gh-release-assets');
const fetch = require('node-fetch');

const apiBaseUrl = 'https://api.github.com/repos/joplin/plugins';

interface Args {
	pluginRepoDir: string;
	dryRun: boolean;
}

interface PluginInfo {
	id: string;
	version: string;
	path?: string;
}

interface ReleaseAsset {
	id: number;
	name: string;
	download_count: number;
	created_at: string;
}

interface Release {
	upload_url: string;
	assets: ReleaseAsset[];
}

async function getRelease(): Promise<Release> {
	const response = await fetch(`${apiBaseUrl}/releases`);
	const releases = await response.json();
	if (!releases.length) throw new Error('No existing release');
	return releases[0];
}

async function getPluginInfos(pluginRepoDir: string): Promise<PluginInfo[]> {
	const pluginDirs = await readdir(`${pluginRepoDir}/plugins`);
	const output: PluginInfo[] = [];

	for (const pluginDir of pluginDirs) {
		const basePath = `${pluginRepoDir}/plugins/${pluginDir}`;
		const manifest = JSON.parse(await readFile(`${basePath}/manifest.json`, 'utf8'));
		output.push({
			id: manifest.id,
			version: manifest.version,
			path: `${basePath}/plugin.jpl`,
		});
	}

	return output;
}

function assetNameFromPluginInfo(pluginInfo: PluginInfo): string {
	return `${pluginInfo.id}@${pluginInfo.version}.jpl`;
}

function pluginInfoFromAssetName(name: string): PluginInfo {
	let s = name.split('.');
	s.pop();
	s = s.join('.').split('@');
	return {
		id: s[0],
		version: s[1],
	};
}

async function deleteAsset(oauthToken: string, id: number) {
	await fetch(`${apiBaseUrl}/releases/assets/${id}`, {
		method: 'DELETE',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `token ${oauthToken}`,
		},
	});
}

async function uploadAsset(oauthToken: string, uploadUrl: string, pluginInfo: PluginInfo) {
	return new Promise((resolve: Function, reject: Function) => {
		ghReleaseAssets({
			url: uploadUrl,
			token: oauthToken,
			assets: [
				{
					name: assetNameFromPluginInfo(pluginInfo),
					path: pluginInfo.path,
				},
			],
		}, (error: Error, assets: any) => {
			if (error) {
				reject(error);
			} else {
				resolve(assets);
			}
		});
	});
}

async function saveStats(statFilePath: string, release: Release) {
	const output: Record<string, any> = await pathExists(statFilePath) ? JSON.parse(await readFile(statFilePath, 'utf8')) : {};

	if (release.assets) {
		for (const asset of release.assets) {
			const pluginInfo = pluginInfoFromAssetName(asset.name);
			if (!output[pluginInfo.id]) output[pluginInfo.id] = {};

			output[pluginInfo.id][pluginInfo.version] = {
				downloadCount: asset.download_count,
				createdAt: asset.created_at,
			};
		}
	}

	await writeFile(statFilePath, JSON.stringify(output, null, '\t'));
}

export default async function(args: Args) {
	const release = await getRelease();
	await saveStats(`${args.pluginRepoDir}/stats.json`, release);

	const pluginInfos = await getPluginInfos(args.pluginRepoDir);
	const oauthToken = await githubOauthToken();

	for (const pluginInfo of pluginInfos) {
		const assetName = assetNameFromPluginInfo(pluginInfo);

		const otherVersionAssets = release.assets.filter(asset => {
			const info = pluginInfoFromAssetName(asset.name);
			return info.id === pluginInfo.id && info.version !== pluginInfo.version;
		});

		for (const asset of otherVersionAssets) {
			console.info(`Deleting old asset ${asset.name}...`);
			await deleteAsset(oauthToken, asset.id);
		}

		const existingAsset = release.assets.find(asset => asset.name === assetName);
		if (existingAsset) continue;
		console.info(`Uploading ${assetName}...`);
		await uploadAsset(oauthToken, release.upload_url, pluginInfo);
	}
}
