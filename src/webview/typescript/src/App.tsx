import { useState, useEffect, useRef } from 'react';
import './App.css';

interface Message {
    text: string;
    isUser: boolean;
    timestamp: Date;
    attachments?: string[];
}

interface FileAttachment {
    name: string;
    path: string;
    type: 'text' | 'image' | 'other';
}

export default function App() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [fileSuggestions, setFileSuggestions] = useState<string[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => { 
        const vscode = (window as any).vscode;
        
        if (!vscode) {
            console.error('VS Code API not available');
            return;
        }

        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'receiveMessage':
                    setMessages(prev => [...prev, {
                        text: message.text,
                        isUser: false,
                        timestamp: new Date()
                    }]);
                    setIsLoading(false);
                    break;
                case 'receiveFiles':
                    setFileSuggestions(message.files || []);
                    break;
                case 'error':
                    setMessages(prev => [...prev, {
                        text: `Error: ${message.text}`,
                        isUser: false,
                        timestamp: new Date()
                    }]);
                    setIsLoading(false);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'webviewReady' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    const handleSendMessage = () => {
        const vscode = (window as any).vscode;
        if (!vscode) return;

        if ((inputValue.trim() || attachedFiles.length > 0) && !isLoading) {
            const newMessage = {
                text: inputValue,
                isUser: true,
                timestamp: new Date(),
                attachments: attachedFiles.map(f => f.name)
            };
            
            setMessages(prev => [...prev, newMessage]);
            vscode.postMessage({
                command: 'sendMessage',
                text: inputValue,
                fileMentions: attachedFiles.map(f => f.path)
            });
            
            setInputValue('');
            setAttachedFiles([]);
            setIsLoading(true);
            setShowSuggestions(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setInputValue(value);
        
        // Check for @ mentions
        const atMatch = value.match(/@([^\s]*)$/);
        if (atMatch) {
            const query = atMatch[1];
            if (query.length >= 0) {
                const vscode = (window as any).vscode;
                vscode.postMessage({
                    command: 'requestFiles',
                    query
                });
                setShowSuggestions(true);
            }
        } else {
            setShowSuggestions(false);
        }
    };

    const selectFile = (filePath: string) => {
        const fileName = filePath.split(/[\\/]/).pop() || '';
        const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
        const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
        
        const fileType: 'text' | 'image' | 'other' = 
            imageExtensions.includes(fileExtension) ? 'image' : 
            ['txt', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'html', 'css', 'json', 'xml', 'md'].includes(fileExtension) ? 'text' : 'other';

        const newAttachment: FileAttachment = {
            name: fileName,
            path: filePath,
            type: fileType
        };

        setInputValue(inputValue.replace(/@[^\s]*$/, '').trim());
        setAttachedFiles(prev => [...prev, newAttachment]);
        setShowSuggestions(false);
        
        setTimeout(() => inputRef.current?.focus(), 0);
    };

    const removeAttachment = (index: number) => {
        setAttachedFiles(prev => prev.filter((_, i) => i !== index));
    };

  const renderMessage = (text: string) => {
      const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
      const inlineCodeRegex = /`([^`]+)`/g;
      
      let processedText = text;
      
      // Process code blocks
      processedText = processedText.replace(codeBlockRegex, (_, language, code) => {
          const escapedCode = escapeHtml(code.trim());
          return `
              <div class="code-block-wrapper">
                  ${language ? `<div class="code-block-header">${language}</div>` : ''}
                  <pre><code>${escapedCode}</code></pre>
              </div>
          `;
      });
      
      // Process inline code
      processedText = processedText.replace(inlineCodeRegex, (_, code) => {
          return `<code class="inline-code">${escapeHtml(code)}</code>`;
      });
      
      // Process line breaks
      processedText = processedText.replace(/\n/g, '<br>');
      
      return { __html: processedText };
  };

    const escapeHtml = (text: string) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    return (
        <div className="chat-container">
            <div className="header">
                <h1>🤖 VS Code AI Assistant</h1>
                <div className="header-info">
                    <span className="status-indicator" title={isLoading ? 'AI is thinking...' : 'Ready'}>
                        {isLoading ? '🔄' : '✅'}
                    </span>
                </div>
            </div>
            
            <div className="messages">
                {messages.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">💬</div>
                        <h3>Welcome to AI Assistant</h3>
                        <p>Start a conversation or type <strong>@</strong> to attach files from your workspace</p>
                        <div className="feature-hints">
                            <div className="hint">💡 Ask me to generate code</div>
                            <div className="hint">📁 Attach files with @filename</div>
                            <div className="hint">🔍 I can analyze your codebase</div>
                        </div>
                    </div>
                ) : (
                    messages.map((msg, index) => (
                        <div key={index} className={`message ${msg.isUser ? 'user' : 'ai'}`}>
                            <div className="message-header">
                                <span className="sender">
                                    {msg.isUser ? '👤 You' : '🤖 AI Assistant'}
                                </span>
                                <span className="timestamp">
                                    {msg.timestamp.toLocaleTimeString()}
                                </span>
                            </div>
                            
                            {msg.attachments && msg.attachments.length > 0 && (
                                <div className="message-attachments">
                                    {msg.attachments.map((attachment, i) => (
                                        <span key={i} className="attachment-badge">
                                            📎 {attachment}
                                        </span>
                                    ))}
                                </div>
                            )}
                            
                            <div 
                                className="message-content"
                                dangerouslySetInnerHTML={renderMessage(msg.text)}
                            />
                        </div>
                    ))
                )}
                
                {isLoading && (
                    <div className="message ai">
                        <div className="message-header">
                            <span className="sender">🤖 AI Assistant</span>
                        </div>
                        <div className="typing-indicator">
                            <div className="typing-dots">
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                            <span className="typing-text">Thinking...</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>
            
            <div className="input-area">
                {attachedFiles.length > 0 && (
                    <div className="attached-files">
                        {attachedFiles.map((file, index) => (
                            <div key={index} className="attached-file">
                                <span className="file-icon">
                                    {file.type === 'image' ? '🖼️' : file.type === 'text' ? '📄' : '📎'}
                                </span>
                                <span className="file-name">{file.name}</span>
                                <button 
                                    className="remove-file"
                                    onClick={() => removeAttachment(index)}
                                    type="button"
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                
                <div className="input-container">
                    <div className="input-wrapper">
                        <input
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder="Type your message or @ to attach files..."
                            disabled={isLoading}
                            className="message-input"
                        />
                        <button 
                            onClick={handleSendMessage}
                            disabled={isLoading || (!inputValue.trim() && attachedFiles.length === 0)}
                            className="send-button"
                            type="button"
                        >
                            {isLoading ? '⏳' : '🚀'}
                        </button>
                    </div>
                    
                    {showSuggestions && fileSuggestions.length > 0 && (
                        <div className="file-suggestions">
                            <div className="suggestions-header">📁 Select a file:</div>
                            {fileSuggestions.slice(0, 10).map((file, i) => {
                                const fileName = file.split(/[\\/]/).pop() || '';
                                const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
                                const isImage = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(fileExtension);
                                
                                return (
                                    <div 
                                        key={i} 
                                        className="file-suggestion"
                                        onClick={() => selectFile(file)}
                                    >
                                        <span className="file-icon">
                                            {isImage ? '🖼️' : '📄'}
                                        </span>
                                        <span className="file-name">{fileName}</span>
                                        <span className="file-path">{file}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}