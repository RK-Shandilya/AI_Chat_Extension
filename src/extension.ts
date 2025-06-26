import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AIConfig, getAIResponse} from './aiService.js';

let webviewPanel: vscode.WebviewPanel | undefined;
let currentAIConfig: AIConfig | undefined;

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-chat.start', () => {
            createOrShowWebview(context);
        })
    );

    const hasShownWelcome = context.globalState.get('ai-chat.hasShownWelcome', false);
    if (!hasShownWelcome) {
        showWelcomeMessage(context);
        context.globalState.update('ai-chat.hasShownWelcome', true);
    }
}

async function createOrShowWebview(context: vscode.ExtensionContext) {
    if (webviewPanel) {
        webviewPanel.reveal(vscode.ViewColumn.Beside);
        return;
    }

    webviewPanel = vscode.window.createWebviewPanel(
        'aiChat',
        '🤖 AI Assistant',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(context.extensionPath, 'src/webview/typescript/dist/assets/'))
            ]
        }
    );

    const files = findLatestFile(context);
    if (!files) {
        webviewPanel.webview.html = getErrorHtml('No File Found');
        return;
    }

    const scriptUri = webviewPanel.webview.asWebviewUri(files.js);
	const styleUri = webviewPanel.webview.asWebviewUri(files.css);
    webviewPanel.webview.html = getWebviewContent(webviewPanel.webview, context.extensionUri, scriptUri, styleUri);

    webviewPanel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case 'webviewReady':
                    webviewPanel?.webview.postMessage({
                        command: 'receiveMessage',
                        text: '👋 **Welcome to AI Assistant!**\n\nI\'m here to help with your coding tasks. You can:\n- Ask me to generate or explain code\n- Attach files using @ mentions\n- Get help with debugging and optimization\n\nWhat would you like to work on?',
                        isAI: true
                    });
                    break;

                case 'sendMessage':
                    await handleUserMessage(message);
                    break;

                case 'requestFiles':
                    await handleFileRequest(message);
                    break;

                default:
                    console.warn('Unknown message command:', message.command);
            }
        },
        undefined,
        context.subscriptions
    );

    webviewPanel.onDidDispose(() => {
        webviewPanel = undefined;
    });
}

async function handleUserMessage(message: any) {
    try {
        let contextContent = '';
        let hasImages = false;

        if (message.fileMentions?.length) {
            for (const filePath of message.fileMentions) {
                const fileInfo = await getFileContent(filePath);
                contextContent += fileInfo.content + '\n\n';
                if (fileInfo.isImage) {
                    hasImages = true;
                }
            }
        }

        if (!message.fileMentions?.length && shouldIncludeWorkspaceContext(message.text)) {
            const workspaceContext = await getWorkspaceContext();
            if (workspaceContext) {
                contextContent += workspaceContext;
            }
        }

        if (hasImages) {
            message.text += '\n\n[Note: Images have been attached. Please analyze them in the context of the request.]';
        }

        const aiResponse = await getAIResponse(message.text, contextContent, currentAIConfig);
        
        webviewPanel?.webview.postMessage({
            command: 'receiveMessage',
            text: aiResponse,
            isAI: true
        });

    } catch (error) {
        console.error('Error processing user message:', error);
        webviewPanel?.webview.postMessage({
            command: 'error',
            text: `Failed to process your message: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
    }
}

async function handleFileRequest(message: any) {
    try {
        const query = message.query || '';
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders) {
            return;
        }

        const searchPattern = query ? `**/*${query}*` : '**/*';
        const excludePattern = '{**/node_modules/**,**/.*/**,**/dist/**,**/build/**}';
        
        const files = await vscode.workspace.findFiles(
            searchPattern,
            excludePattern,
            50
        );

        const filteredFiles = files
            .filter(file => {
                const basename = path.basename(file.fsPath);
                return !basename.startsWith('.') && basename.toLowerCase().includes(query.toLowerCase());
            })
            .sort((a, b) => {
                const aName = path.basename(a.fsPath);
                const bName = path.basename(b.fsPath);
                
                if (aName.toLowerCase() === query.toLowerCase()) return -1;
                if (bName.toLowerCase() === query.toLowerCase()) return 1;
                
                const aStarts = aName.toLowerCase().startsWith(query.toLowerCase());
                const bStarts = bName.toLowerCase().startsWith(query.toLowerCase());
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
                
                return aName.localeCompare(bName);
            });

        webviewPanel?.webview.postMessage({
            command: 'receiveFiles',
            files: filteredFiles.map(f => f.fsPath)
        });

    } catch (error) {
        console.error('Error finding files:', error);
        webviewPanel?.webview.postMessage({
            command: 'receiveFiles',
            files: []
        });
    }
}

interface FileInfo {
    content: string;
    isImage: boolean;
    size: number;
}

async function getFileContent(filePath: string): Promise<FileInfo> {
    try {
        const uri = vscode.Uri.file(filePath);
        const stat = await vscode.workspace.fs.stat(uri);
        const fileName = path.basename(filePath);
        const fileExtension = path.extname(filePath).toLowerCase();
        
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp'];
        const isImage = imageExtensions.includes(fileExtension);
        
        const maxSize = 5 * 1024 * 1024;
        if (stat.size > maxSize) {
            return {
                content: `[File too large: ${fileName} (${(stat.size / 1024 / 1024).toFixed(1)}MB) - Please use a smaller file]`,
                isImage: false,
                size: stat.size
            };
        }

        if (isImage) {
            const imageInfo = await getImageInfo(filePath, stat.size);
            return {
                content: imageInfo,
                isImage: true,
                size: stat.size
            };
        } else {
            const fileContent = await vscode.workspace.fs.readFile(uri);
            const content = Buffer.from(fileContent).toString('utf8');
            
            if (content.includes('\0')) {
                return {
                    content: `[Binary file: ${fileName} - Cannot display content]`,
                    isImage: false,
                    size: stat.size
                };
            }
            
            return {
                content: `[File: ${fileName}]\n\`\`\`${fileExtension.substring(1) || 'text'}\n${content}\n\`\`\``,
                isImage: false,
                size: stat.size
            };
        }
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        return {
            content: `[Error reading file: ${path.basename(filePath)} - ${error instanceof Error ? error.message : 'Unknown error'}]`,
            isImage: false,
            size: 0
        };
    }
}

async function getImageInfo(filePath: string, size: number): Promise<string> {
    const fileName = path.basename(filePath);
    const extension = path.extname(filePath).toLowerCase();
    
    try {
        const uri = vscode.Uri.file(filePath);
        const fileContent = await vscode.workspace.fs.readFile(uri);
        const base64 = Buffer.from(fileContent).toString('base64');
        
        return `[Image: ${fileName}]
File size: ${(size / 1024).toFixed(1)} KB
Format: ${extension.substring(1).toUpperCase()}
Base64 data: data:image/${extension.substring(1)};base64,${base64.substring(0, 100)}...

This image has been attached for analysis. Please describe what you see and how it relates to the user's question.`;
    } catch (error) {
        return `[Image: ${fileName} - Error reading image data: ${error instanceof Error ? error.message : 'Unknown error'}]`;
    }
}

function shouldIncludeWorkspaceContext(text: string): boolean {
    const contextKeywords = [
        'project', 'workspace', 'codebase', 'architecture', 'structure',
        'overview', 'analyze', 'review', 'understand'
    ];
    
    const lowerText = text.toLowerCase();
    return contextKeywords.some(keyword => lowerText.includes(keyword));
}

async function getWorkspaceContext(): Promise<string> {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return '';

        const configFiles = ['package.json', 'tsconfig.json', 'README.md', 'requirements.txt', 'Cargo.toml'];
        let context = '[Workspace Context]\n';

        for (const configFile of configFiles) {
            try {
                const files = await vscode.workspace.findFiles(`**/${configFile}`, undefined, 1);
                if (files.length > 0) {
                    const content = await vscode.workspace.fs.readFile(files[0]);
                    const text = Buffer.from(content).toString('utf8');
                    context += `\n[${configFile}]\n\`\`\`${configFile.endsWith('.json') ? 'json' : 'text'}\n${text.substring(0, 1000)}\n\`\`\`\n`;
                }
            } catch (error) {
                // Ignore errors for individual files
            }
        }

        return context.length > 50 ? context : '';
    } catch (error) {
        console.error('Error getting workspace context:', error);
        return '';
    }
}

async function showWelcomeMessage(context: vscode.ExtensionContext) {
    const action = await vscode.window.showInformationMessage(
        '🤖 Welcome to AI Assistant! Get started by configuring your AI provider.',
        'Configure Now',
        'Start Chat',
        'Later'
    );

    switch (action) {
        case 'Start Chat':
            createOrShowWebview(context);
            break;
    }
}

function findLatestFile(context: vscode.ExtensionContext): { js: vscode.Uri, css: vscode.Uri } | null {
    const distPath = path.join(context.extensionPath, 'src/webview/typescript/dist/assets/');
    try {
        const files = fs.readdirSync(distPath);
        const jsFiles = files.filter(f => f.startsWith('index-') && f.endsWith('.js'));
        const cssFiles = files.filter(f => f.startsWith('main-') && f.endsWith('.css'));

        if (jsFiles.length === 0 || cssFiles.length === 0) {
            console.error('No files found in:', distPath);
            return null;
        }

        const latestFile = jsFiles.sort().pop();
        if (latestFile) {
            return {
				js: vscode.Uri.file(path.join(distPath, latestFile)),
				css: vscode.Uri.file(path.join(distPath, cssFiles[0]))
			}
        }
    } catch (err) {
        console.error('Error finding JS file:', err);
    }
    return null;
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri, scriptUri?: vscode.Uri, styleUri?: vscode.Uri): string {

  const csp = `
    default-src 'none';
    script-src ${webview.cspSource} 'unsafe-inline';
    style-src ${webview.cspSource} 'unsafe-inline';
    img-src ${webview.cspSource} https: data:;
    font-src ${webview.cspSource};
  `;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link href="${styleUri}" rel="stylesheet">
  <title>AI Chat</title>
  <script>
    window.vscode = acquireVsCodeApi();
  </script>
</head>
<body>
  <div id="root"></div>
  <script src="${scriptUri}"></script>
</body>
</html>
  `;
}

function getErrorHtml(message: string): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                padding: 20px;
                background: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
            }
            .error-container {
                max-width: 600px;
                margin: 0 auto;
                text-align: center;
            }
            .error-icon {
                font-size: 48px;
                margin-bottom: 16px;
            }
            h1 {
                color: var(--vscode-errorForeground);
                margin-bottom: 16px;
            }
            p {
                line-height: 1.5;
                margin-bottom: 24px;
            }
            .help-text {
                font-size: 14px;
                opacity: 0.8;
                background: var(--vscode-textBlockQuote-background);
                padding: 16px;
                border-radius: 8px;
                border-left: 4px solid var(--vscode-textBlockQuote-border);
            }
        </style>
    </head>
    <body>
        <div class="error-container">
            <div class="error-icon">⚠️</div>
            <h1>Extension Error</h1>
            <p>${message}</p>
            <div class="help-text">
                <strong>Troubleshooting:</strong><br>
                1. Make sure you've built the webview: <code>npm run build</code><br>
                2. Check that the dist folder exists in src/webview/typescript/<br>
                3. Restart VS Code if the issue persists
            </div>
        </div>
    </body>
    </html>`;
}

export function deactivate() {
    if (webviewPanel) {
        webviewPanel.dispose();
    }
}