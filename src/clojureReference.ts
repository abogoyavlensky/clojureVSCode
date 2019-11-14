import * as vscode from 'vscode';

import { cljConnection } from './cljConnection';
import { cljParser } from './cljParser';
import { nreplClient } from './nreplClient';

interface FnRef {
    column: number,
    doc: string,
    file: string,
    line: number,
    name: string
}

function getLocationFromFnRef(ref: FnRef) {
    const filePath = !ref.file.startsWith('file:') ? 'file:' + ref.file : ref.file,
        uri = vscode.Uri.parse(filePath),
        pos = new vscode.Position(ref.line - 1, ref.column);
    return new vscode.Location(uri, pos);
}


export class ClojureReferenceProvider implements vscode.ReferenceProvider {

    provideReferences(document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken): vscode.ProviderResult<vscode.Location[]> {

        if (!cljConnection.isConnected())
            return Promise.reject('No nREPL connected.');

        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange)
            return Promise.reject('No word selected.');

        const currentWord: string = document.lineAt(position.line).text.slice(wordRange.start.character, wordRange.end.character);
        const ns = cljParser.getNamespace(document.getText());

        return cljConnection.sessionForFilename(document.fileName).then(session => {
            return nreplClient.fnRefs(currentWord, ns, session.id).then((fnRefs: FnRef[]) => {

                // TODO: get self declaration if context has `true`

                const locations = fnRefs.map(ref => getLocationFromFnRef(ref))
                return Promise.resolve(locations);
            });
        });
    }

}
