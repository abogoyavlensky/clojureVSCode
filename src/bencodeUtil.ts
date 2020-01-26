import * as bencoder from 'bencoder';
import * as vscode from 'vscode';

const CONTINUATION_ERROR_MESSAGE: string = "Unexpected continuation: \"";

interface DecodedResult {
    decodedObjects: any[];
    rest: Buffer;
}

export function encode(msg: any): Buffer {
    return bencoder.encode(msg);
}

/*
    receives a buffer and returns an array of decoded objects and the remaining unused buffer
*/
export function decodeObjects(buffer: Buffer): DecodedResult {
    const decodedResult: DecodedResult = { decodedObjects: [], rest: buffer };
    return decode(decodedResult);
}

function decode(decodedResult: DecodedResult): DecodedResult {
    if (decodedResult.rest.length === 0)
        return decodedResult;

    try {
        // console.log('JS BENCODE');
        // console.log(ben.decode(decodedResult.rest));

        const decodedObj = bencoder.decode(decodedResult.rest);
        // console.log('DATA');
        // console.log(decodedObj);

        decodedResult.decodedObjects.push(decodedObj);
        decodedResult.rest = Buffer.from('');
        return decodedResult;
    } catch (error) {
        // console.log("REST!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        // console.log(error)

        const errorMessage: string = error.message;
        if (!!errorMessage && errorMessage.startsWith(CONTINUATION_ERROR_MESSAGE)) {
            const unexpectedContinuation: string = errorMessage.slice(CONTINUATION_ERROR_MESSAGE.length, errorMessage.length - 1);

            const rest = decodedResult.rest;
            const encodedObj = rest.slice(0, rest.length - unexpectedContinuation.length);

            let legalPart: string = '';
            try {
                legalPart = bencoder.decode(encodedObj);
            } catch (ERR) {


                const buf = decodeBuffer(rest);
                console.log("MESSAGE");
                console.log(buf);



                console.log(ERR);
                const unexp = ERR.message.slice(CONTINUATION_ERROR_MESSAGE.length, ERR.message.length - 1);
                const oneMore = encodedObj.slice(0, encodedObj.length - unexp.length);
                try {
                    const DATA_LAST = bencoder.decode(oneMore);
                    console.log(DATA_LAST);
                } catch (ERR2) {
                    console.log(ERR2);
                }
            }

            decodedResult.decodedObjects.push(legalPart);
            decodedResult.rest = Buffer.from(unexpectedContinuation);

            return decode(decodedResult);
        } else {
            console.log("UNCAUGHT???????????????????");
            console.log(error)

            return decodedResult;
        }
    }
}





interface Message {
    msg: any;
    buffer: Buffer;
    msgLen: number;
}

const BENCODE_END_SYMBOL = 0x65;  // `e`
const VALUE_LENGTH_REGEXP = /\:(?<name>value|out)(?<len>\d+)\:/m;


function isMessageIncomplete(message: Message): boolean {
    const lastByte = message.buffer[message.buffer.length - 1],
        matched = message.buffer.toString().match(VALUE_LENGTH_REGEXP),
        // @ts-ignore: target es6 doesn't support `groups` in RegExpMatchArray
        {groups: {len, name} = {}} = matched  || {},
        requiredLength = len ? Number.parseInt(len) : null,
        isLengthInvalid = name in message.msg
            && requiredLength !== null
            // check length of parsed message
            && message.msg[name].length < requiredLength;

    return message.msgLen === message.buffer.length  // whole buffer has been parsed
        // message's length is valid and the end symbol is presented
        && (isLengthInvalid || lastByte !== BENCODE_END_SYMBOL);
}


function decodeNextMessage(data: Buffer): Message {
    let message: Message = { msg: null, buffer: data, msgLen: data.length};

    while (!message.msg) {
        try {
            message.msg = bencoder.decode(message.buffer.slice(0, message.msgLen));

            if (isMessageIncomplete(message)) {
                message.msg = null;
                break;
            }

        } catch (error) {
            if (!!error.message && error.message.startsWith(CONTINUATION_ERROR_MESSAGE)) {
                const unexpectedContinuation: string = error.message.slice(CONTINUATION_ERROR_MESSAGE.length,
                                                                           error.message.length - 1);
                message.msgLen -= unexpectedContinuation.length;
            } else {
                vscode.window.showErrorMessage('Unexpected output decoding error.');
                console.log("UNCAUGHT ERROR!");
                break;
            }
        }
    }

    return message;
}


export function decodeBuffer(data: Buffer): DecodedResult {
    let result: DecodedResult = { decodedObjects: [], rest: data };

    while (true) {
        if (result.rest.length === 0) {
            result.rest = Buffer.from('');
            break;
        }

        const message = decodeNextMessage(result.rest);
        if (!message.msg) {
            break;
        }

        result.decodedObjects.push(message.msg);
        result.rest = result.rest.slice(message.msgLen, result.rest.length);

        if (message.msg.status && message.msg.status.indexOf('done') > -1) {
            break;
        }
    }

    return result;
}
