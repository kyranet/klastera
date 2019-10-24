import { Server as VezaServer, ServerSocket, NetworkError, NodeMessage } from 'veza';
import { fork, Cluster } from 'cluster';
import { mergeDefault, sleep, isNumber } from '@klasa/utils';
import fetch from 'node-fetch';
import { DiscordHTTP } from '../util/Constants';
import { isAbsolute, join } from 'path';
import { statSync } from 'fs';

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

const serverHardPrivates = new WeakMap<Server, string | null>();

export class Server extends VezaServer {

	/**
	 * The child processes this server has access to.
	 */
	private childProcesses = new Map<number, Cluster>();

	/**
	 * The child process path.
	 */
	private childProcessPath: string;

	/**
	 * The shard count, either a fixed number, or automatic.
	 */
	private shardCount: number | 'auto';

	/**
	 * The amount of shards this cluster should spawn.
	 */
	private shardsPerCluster: number | null;

	/**
	 * The amount of guilds each shard should have.
	 */
	private guildsPerShard: number | null;

	/**
	 * Whether shards should automatically respawn upon exiting.
	 */
	private respawn: boolean;

	/**
	 * The timeout before throwing when a shard takes too long to hit ready.
	 */
	private timeout: number;

	/**
	 * Whether shards should automatically respawn when they failed to instantiate.
	 */
	private retry: boolean;

	public constructor(childProcessPath: string, options: KlasteraServerOptions = {}) {
		super(options.vezaServerName ?? 'Klastera-Master');
		this.childProcessPath = this.validateFilePath(childProcessPath);

		// Process the defaults
		serverHardPrivates.set(this, (options.token ?? process.env.DISCORD_TOKEN) || null);
		this.shardCount = options.shardCount ?? 'auto';
		this.shardsPerCluster = options.shardsPerCluster ?? null;
		this.guildsPerShard = options.guildsPerShard ?? null;
		this.respawn = options.respawn ?? true;
		this.timeout = options.timeout ?? 60000;
		this.retry = options.retry ?? true;
	}

	/**
	 * Spawns all shards locally
	 */
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

		if (this.shardCount === 'auto') {
			this.shardCount = shards;
		} else if (!isNumber(this.shardCount) || this.shardCount < 1) {
			throw new Error('shardCount is not a valid number.');
		}

		if (session_start_limit.remaining === 0) {
			this.emit('debug', `Session limit reached, continuing in ${session_start_limit.reset_after}`);
			await sleep(session_start_limit.reset_after);
		}

		return this;
	}

	/**
	 * Serves the server for detached connections (the clients do NOT have to live on the same machine as the server)
	 */
	public serve(options: KlasteraSpawnOptions = { port: 9999 }) {
		return 'port' in options
			? this.listen(options.port, options.address)
			: this.listen(options.path);
	}

	// https://github.com/discordjs/discord.js/blob/dad0cd8e81e3f530d5e0dda1ea45359c602372ca/src/util/Util.js#L224-L233
	private async _fetchSessionLimit() {
		const token = serverHardPrivates.get(this);
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

	private validateFilePath(childProcessPath: string) {
		if (!childProcessPath) throw new Error('A childProcessPath was not specified.');
		if (!isAbsolute(childProcessPath)) childProcessPath = join(process.cwd(), childProcessPath);
		if (!statSync(childProcessPath).isFile()) throw new Error('The childProcessPath did not resolve to a file.');
		return childProcessPath;
	}

}

export interface Server {
	/**
	 * Emitted when the server receives data.
	 */
	on(event: 'raw', listener: (data: Uint8Array, client: ServerSocket) => void): this;
	/**
	 * Emitted when the server opens.
	 */
	on(event: 'open', listener: () => void): this;
	/**
	 * Emitted when the server closes.
	 */
	on(event: 'close', listener: () => void): this;
	/**
	 * Emitted when an error occurs.
	 */
	on(event: 'error', listener: (error: Error | NetworkError, client: ServerSocket | null) => void): this;
	/**
	 * Emitted when a new connection is made and set up.
	 */
	on(event: 'connect', listener: (client: ServerSocket) => void): this;
	/**
	 * Emitted when a client disconnects from the server.
	 */
	on(event: 'disconnect', listener: (client: ServerSocket) => void): this;
	/**
	 * Emitted when the server receives and parsed a message.
	 */
	on(event: 'message', listener: (message: NodeMessage, client: ServerSocket) => void): this;
	/**
	 * Emitted when the sharding manager processes something.
	 */
	on(event: 'debug', listener: (message: string) => void): this;
	/**
	 * Emitted when the server receives data.
	 */
	once(event: 'raw', listener: (data: Uint8Array, client: ServerSocket) => void): this;
	/**
	 * Emitted when the server opens.
	 */
	once(event: 'open', listener: () => void): this;
	/**
	 * Emitted when the server closes.
	 */
	once(event: 'close', listener: () => void): this;
	/**
	 * Emitted when an error occurs.
	 */
	once(event: 'error', listener: (error: Error | NetworkError, client: ServerSocket | null) => void): this;
	/**
	 * Emitted when a new connection is made and set up.
	 */
	once(event: 'connect', listener: (client: ServerSocket) => void): this;
	/**
	 * Emitted when a client disconnects from the server.
	 */
	once(event: 'disconnect', listener: (client: ServerSocket) => void): this;
	/**
	 * Emitted once when a server is ready.
	 */
	once(event: 'ready', listener: () => void): this;
	/**
	 * Emitted when the server receives and parsed a message.
	 */
	once(event: 'message', listener: (message: NodeMessage, client: ServerSocket) => void): this;
	/**
	 * Emitted when the sharding manager processes something.
	 */
	once(event: 'debug', listener: (message: string) => void): this;
	/**
	 * Emitted when the server receives data.
	 */
	off(event: 'raw', listener: (data: Uint8Array, client: ServerSocket) => void): this;
	/**
	 * Emitted when the server opens.
	 */
	off(event: 'open', listener: () => void): this;
	/**
	 * Emitted when the server closes.
	 */
	off(event: 'close', listener: () => void): this;
	/**
	 * Emitted when an error occurs.
	 */
	off(event: 'error', listener: (error: Error | NetworkError, client: ServerSocket | null) => void): this;
	/**
	 * Emitted when a new connection is made and set up.
	 */
	off(event: 'connect', listener: (client: ServerSocket) => void): this;
	/**
	 * Emitted when a client disconnects from the server.
	 */
	off(event: 'disconnect', listener: (client: ServerSocket) => void): this;
	/**
	 * Emitted when the server receives and parsed a message.
	 */
	off(event: 'message', listener: (message: NodeMessage, client: ServerSocket) => void): this;
	/**
	 * Emitted when the sharding manager processes something.
	 */
	off(event: 'debug', listener: (message: string) => void): this;
	/**
	 * Emits raw data received from the underlying socket.
	 */
	emit(event: 'raw', data: Uint8Array, client: ServerSocket): boolean;
	/**
	 * Emits a server open event.
	 */
	emit(event: 'open'): boolean;
	/**
	 * Emits a server close event.
	 */
	emit(event: 'close'): boolean;
	/**
	 * Emits a server error event.
	 */
	emit(event: 'error', error: Error | NetworkError, client: ServerSocket | null): boolean;
	/**
	 * Emits a connection made and set up to the server.
	 */
	emit(event: 'connect', client: ServerSocket): boolean;
	/**
	 * Emits a disconnection of a client from the server.
	 */
	emit(event: 'disconnect', client: ServerSocket): boolean;
	/**
	 * Emits a parsed NodeMessage instance ready for usage.
	 */
	emit(event: 'message', message: NodeMessage, client: ServerSocket): boolean;
	/**
	 * Emits a debug log.
	 */
	emit(event: 'debug', message: string): boolean;
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
	vezaServerName?: string;
	shardCount?: number | 'auto';
	shardsPerCluster?: number;
	guildsPerShard?: number;
	respawn?: boolean;
	timeout?: number;
	retry?: boolean;
	debug?: (info: string, ...args: unknown[]) => void;
}
