import * as vscode from 'vscode';
import * as net from 'net';
import { Buffer } from 'buffer';

import * as bencodeUtil from './bencodeUtil';
import { cljConnection, CljConnectionInformation } from './cljConnection';

interface nREPLCompleteMessage {
    op: string;
    symbol: string;
    ns?: string
}

interface nREPLInfoMessage {
    op: string;
    symbol: string;
    ns: string;
    session?: string;
}

type TestMessage = {
    op: "test" | "test-all" | "test-stacktrace" | "retest"
    ns?: string,
    'load?'?: any
}

interface nREPLEvalMessage {
    op: string;
    file: string;
    'file-path'?: string;
    session: string;
    'nrepl.middleware.print/stream?'?: number;
    // 'nrepl.middleware.print/buffer-size'?: number;
}

interface nREPLSingleEvalMessage {
    op: string;
    code: string;
    session: string;
}

interface nREPLStacktraceMessage {
    op: string;
    session: string;
}

interface nREPLCloneMessage {
    op: string;
    session?: string;
}

interface nREPLCloseMessage {
    op: string;
    session?: string;
}

const complete = (symbol: string, ns: string): Promise<any> => {
    const msg: nREPLCompleteMessage = { op: 'complete', symbol, ns };
    return send(msg).then(respObjs => respObjs[0]);
};

const info = (symbol: string, ns: string, session?: string): Promise<any> => {
    const msg: nREPLInfoMessage = { op: 'info', symbol, ns, session };
    return send(msg).then(respObjs => respObjs[0]);
};

const evaluate = (code: string, session?: string): Promise<any[]> => clone(session).then((session_id) => {
    const msg: nREPLSingleEvalMessage = { op: 'eval', code: code, session: session_id };
    return send(msg);
});

const evaluateFile = (code: string, filepath: string, session?: string): Promise<any[]> => clone(session).then((session_id) => {
    const msg: nREPLEvalMessage = {
        op: 'load-file',
        file: code,
        'file-path': filepath,
        session: session_id,
        'nrepl.middleware.print/stream?': 1,
        // 'nrepl.middleware.print/buffer-size': 2048,
    };
    // return send(msg);
    return sendEval(msg);
});

const stacktrace = (session: string): Promise<any> => send({ op: 'stacktrace', session: session });

const runTests = function (namespace: string | undefined): Promise<any[]> {
    const message: TestMessage = {
        op: (namespace ? "test" : "test-all"),
        ns: namespace,
        'load?': 1
    }
    return send(message);
}


const clone = (session?: string): Promise<string> => send({ op: 'clone', session: session }).then(respObjs => respObjs[0]['new-session']);

const test = (connectionInfo: CljConnectionInformation): Promise<any[]> => {
    return send({ op: 'clone' }, connectionInfo)
        .then(respObjs => respObjs[0])
        .then(response => {
            if (!('new-session' in response))
                return Promise.reject(false);
            else {
                return Promise.resolve([]);
            }
        });
};

const close = (session?: string): Promise<any[]> => send({ op: 'close', session: session });

const listSessions = (): Promise<[string]> => {
    return send({ op: 'ls-sessions' }).then(respObjs => {
        const response = respObjs[0];
        if (response.status[0] == "done") {
            return Promise.resolve(response.sessions);
        }
    });
}

type Message = TestMessage | nREPLCompleteMessage | nREPLInfoMessage | nREPLEvalMessage | nREPLStacktraceMessage | nREPLCloneMessage | nREPLCloseMessage | nREPLSingleEvalMessage;

const send = (msg: Message, connection?: CljConnectionInformation): Promise<any[]> => {

    console.log("nREPL: Sending op", msg);

    return new Promise<any[]>((resolve, reject) => {
        connection = connection || cljConnection.getConnection();

        if (!connection)
            return reject('No connection found.');

        const client = net.createConnection(connection.port, connection.host);
        Object.keys(msg).forEach(key => (msg as any)[key] === undefined && delete (msg as any)[key]);
        client.write(bencodeUtil.encode(msg), 'binary');

        client.on('error', error => {
            client.end();
            client.removeAllListeners();
            if ((error as any)['code'] === 'ECONNREFUSED') {
                vscode.window.showErrorMessage('Connection refused.');
                cljConnection.disconnect();
            }
            reject(error);
        });

        let nreplResp = Buffer.from('');
        const respObjects: any[] = [];
        client.on('data', data => {
            nreplResp = Buffer.concat([nreplResp, data]);
            const { decodedObjects, rest } = bencodeUtil.decodeObjects(nreplResp);
            nreplResp = rest;
            const validDecodedObjects = decodedObjects.reduce((objs, obj) => {
                if (!isLastNreplObject(objs))
                    objs.push(obj);
                return objs;
            }, []);
            respObjects.push(...validDecodedObjects);

            if (isLastNreplObject(respObjects)) {
                client.end();
                client.removeAllListeners();
                resolve(respObjects);
            }
        });
    });
};


const sendEval = (msg: Message, connection?: CljConnectionInformation): Promise<any[]> => {

    console.log("nREPL: Sending op", msg);

    return new Promise<any[]>((resolve, reject) => {
        connection = connection || cljConnection.getConnection();

        if (!connection)
            return reject('No connection found.');

        const client = net.createConnection(connection.port, connection.host);

        Object.keys(msg).forEach(key => (msg as any)[key] === undefined && delete (msg as any)[key]);
        client.write(bencodeUtil.encode(msg), 'binary');

        client.on('error', error => {
            client.end();
            client.removeAllListeners();
            if ((error as any)['code'] === 'ECONNREFUSED') {
                vscode.window.showErrorMessage('Connection refused.');
                cljConnection.disconnect();
            }
            reject(error);
        });


        client.on('end', () => {
            console.log("END STREAM");
            // console.log(data);
        });

        client.on('finish', () => {
            console.log("FINISH");
            // console.log(data);
        });

        client.on('close', () => {
            console.log('CLOSED');
        });


        client.on('timeout', () => {
            console.log('TIMEOUT');
        });

        let nreplResp = Buffer.from(''),
            lastIndex = 0;
        const respObjects: any[] = [];
        // const stack: any[] = [];
        client.on('data', data => {
            // console.log('DATA');
            // const res = bencodeUtil.decodeObjects(data).decodedObjects;
            // console.log(res)

            // console.log('JS BENCODE');
            // console.log(ben.decode(data));

            // stack.push(...res)
            // console.log('STACK');
            // console.log(stack);

            // TODO: uncomment!
            nreplResp = Buffer.concat([nreplResp, data]);
            // const { decodedObjects, rest } = bencodeUtil.decodeObjects(nreplResp);
            const { decodedObjects, rest } = bencodeUtil.decodeBuffer(nreplResp);
            nreplResp = rest;

            // const validDecodedObjects = decodedObjects.reduce((objs, obj) => {
            //     if (!isLastNreplObject(objs))
            //         objs.push(obj);
            //     return objs;
            // }, []);
            // respObjects.push(...validDecodedObjects);

            respObjects.push(...decodedObjects);

            // console.log('RESULT')
            // console.log(respObjects);

            // if (isLastNreplObject(respObjects)) {
            //     client.end();
            //     client.removeAllListeners();
            //     resolve(respObjects);
            // }

            // console.log("RESP!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");

            // const { decodedObjects, rest } = bencodeUtil.decodeObjects(nreplResp);
            // console.log(decodedObjects);
            // if (isLastNreplObjectSoft(respObjects)) {
            //     client.end();
            //     client.removeAllListeners();
            //     resolve(respObjects);
            // }

            // if (isThereLastNreplObject(lastIndex, respObjects)) {
            if (isLastNreplObjectSoft(respObjects)) {
                client.end();
                client.removeAllListeners();
                resolve(respObjects);
            }
            //  else {
                // lastIndex = respObjects.length;
            // }

        });

    });
};


const isDone = (lastObj: any): boolean => {
    return lastObj && lastObj.status && lastObj.status.indexOf('done') > -1;
}

const isThereLastNreplObject = (lastIndex: number, nreplObjects: any[]): boolean => {
    for (let i = lastIndex; i < nreplObjects.length; i++) {
        if (isDone(nreplObjects[i])) {
            return true
        }
    }
    return false;
}


const isLastNreplObjectSoft = (nreplObjects: any[]): boolean => {
    const lastObj = nreplObjects[nreplObjects.length - 1];
    return lastObj && lastObj.status && lastObj.status.indexOf('done') > -1;
}


const isLastNreplObject = (nreplObjects: any[]): boolean => {
    const lastObj = [...nreplObjects].pop();
    return lastObj && lastObj.status && lastObj.status.indexOf('done') > -1;
}

export const nreplClient = {
    complete,
    info,
    evaluate,
    evaluateFile,
    stacktrace,
    clone,
    test,
    runTests,
    close,
    listSessions
};
