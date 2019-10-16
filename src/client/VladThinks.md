# Pleasing Kyra - A story in 2 acts

## Server Type

A server can be ran in two ways:

### All local

In this mode, the sharding is handled on the same machine as the Veza server

Shards are spawned via `Server#spawn`, forked with cluster. Same behavior as Kurasuta

### Remote

In this mode, the Server is served via `Server#serve`. Clusters that extend `klastera/client` are expected to connect to this Server

The Server/Client implementation is expected to implement some form of packet verification to prevent people from injecting their payloads (:lenny:) into the sharder, should they find the IP.


## Sharding

In `Local Mode`, the sharder should spawn shardCount / shardsPerCluster forks of the `client` library.

#### Example

```ts
new Server({
	shardCount: 6,
	shardsPerCluster: 3,
});
// This spawns 2 processes
```

In `Remote Mode`, the sharder should tell each process what shards it should spawn, and cache which connection has which shards. A heartbeat mechanism should be implemented to prevent network errors from letting shards die.

The same spreading logic applies for spreading shards as for local!
