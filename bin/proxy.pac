function FindProxyForURL(url, host) {
    if (/:\/\/[\d.]+\/kcsapi\//.test(url)) {
        return 'PROXY 127.0.0.1:8099';
    } else {
        return 'DIRECT';
    }
}
