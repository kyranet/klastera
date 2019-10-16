import { Server as VezaServer } from 'veza';
import { fork, Cluster } from 'cluster';
import { mergeDefault, sleep } from '@klasa/utils';
import fetch from 'node-fetch';
import { DiscordHTTP } from '../util/Constants';

export interface DiscordSessionObject {
	url: string;
	shards: number;
	session_start_limit: {
		total: number;
		remaining: number;
		reset_after: number;
	};
}

export interface DiscordError {
	message: string;
	code: number;
}

export class Server extends VezaServer {
	private childProcesses: Map<number, Cluster> = new Map();
	private childProcessPath: string;
	private options: KlasteraServerOptions;

	public constructor(childProcessPath: string, options?: KlasteraServerOptions) {
		super('Klastera-Master');
		this.childProcessPath = childProcessPath;
		this.options = mergeDefault({}, options);
	}

	public async spawn(options: KlasteraSpawnOptions = { port: 9999 }) {
		await ('port' in options
			? this.listen(options.port, options.address)
			: this.listen(options.path));

		// Summon clusters!
		// Let's go for the former first, then we can enhance to handle it ourselves
		// if we complicate the initial setup, this will be significantly harder to
		// finish and test, you know.

		const sessionData = await this._fetchSessionLimit();
		const { shards, session_start_limit } = sessionData;

		if (this.options.shardCount === 'auto') {
			this.options.shardCount = shards;
		}

		if (session_start_limit.remaining === 0) {
			this.options.debug?.(`Session limit reached, continuing in ${session_start_limit.reset_after}`);
			sleep(session_start_limit.reset_after);
		}

		return this;
	}

	// https://github.com/discordjs/discord.js/blob/dad0cd8e81e3f530d5e0dda1ea45359c602372ca/src/util/Util.js#L224-L233
	private async _fetchSessionLimit() {
		const { token } = this.options;
		if (!token) throw new Error('You must provide a token in the master');

		const url = `${DiscordHTTP.api}/v${DiscordHTTP.version}/gateway/bot`;
		const headers = { Authorization: `Bot ${token.replace(/^Bot\s*/i, '')}` } as const;
		const result = await fetch(url, { headers });

		// If 200 <= status < 400, json is a DiscordSessionObject
		if (result.ok) return await result.json() as DiscordSessionObject;
		// If (400 <=) status < 500, json is a DiscordError
		if (result.status < 500) throw new Error((await result.json() as DiscordError).message);
		// Else status > 500, json can be anything, abort.
		throw result;
	}
}

export type KlasteraSpawnOptions = KlasteraSpawnOptionsTCP | KlasteraSpawnOptionsIPC;

export interface KlasteraSpawnOptionsTCP {
	port: number;
	address?: string;
}

export interface KlasteraSpawnOptionsIPC {
	path: string;
}

export interface KlasteraServerOptions {
	token?: string;
	shardCount?: number | 'auto';
	shardsPerCluster?: number;
	guildsPerShard?: number;
	respawn?: boolean;
	timeout?: number;
	retry?: boolean;
	debug?: (info: string, ...args: unknown[]) => void;
}
