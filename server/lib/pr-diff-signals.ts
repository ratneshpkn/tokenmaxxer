const LOCK_OR_BUNDLE_SUFFIX_RE =
	/(?:\.lockb?|-lock\.(?:json|ya?ml|toml|txt|xml)|(?:^|[/\\])(?:go\.sum|npm-shrinkwrap\.json|Package\.resolved|Podfile\.resolved|packages\.lock\.json|paket\.lock)|\.snap|\.map|\.(?:min|bundle|chunk)\.[^/\\]+|\.(?:generated|g|freezed)\.[^/\\]+|\.pb\.(?:go|ts|js|cc|h)|_pb2(?:_grpc)?\.py|\.(?:wasm|pyc|class|o|so|dylib|dll|exe|jar|whl|tgz|zip|woff2?|ttf|eot|ico|pdf|svg))$/i

const BUNDLE_OR_VENDOR_DIR_RE =
	/(?:^|[/\\])(?:dist|build|\.next|\.nuxt|out|coverage|node_modules|Pods|vendor|third_party|__generated__|__snapshots__)[/\\]/i

export function isBlacklistedPatchFile(filename: string): boolean {
	const trimmed = filename.trim()
	return LOCK_OR_BUNDLE_SUFFIX_RE.test(trimmed) || BUNDLE_OR_VENDOR_DIR_RE.test(trimmed)
}
