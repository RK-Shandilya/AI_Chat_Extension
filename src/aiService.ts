import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import * as path from 'path';
dotenv.config({ path: path.resolve(import.meta.url, '../.env') });

interface AIConfig {
    provider: 'google';
    apiKey: string;
    model: string;
}

const DEFAULT_CONFIG: AIConfig = {
    provider: 'google',
    apiKey: process.env.GOOGLE_AI_API_KEY || "",
    model: "gemini-1.5-flash"
};

let googleAI: GoogleGenAI | null = null;

function initializeGoogleAI(apiKey: string) {
    if (!googleAI) {
        googleAI = new GoogleGenAI({apiKey: apiKey});
    }
    return googleAI;
}

async function getGoogleAIResponse(prompt: string, context: string, config: AIConfig): Promise<string> {
    try {
        const genAI = initializeGoogleAI(config.apiKey);

        const systemPrompt = `You are an AI coding assistant integrated into VS Code. You help developers with:

🔧 **Code Generation & Refactoring**
- Generate clean, efficient code in any programming language
- Refactor existing code for better performance and readability
- Create boilerplate code, templates, and scaffolding

🐛 **Code Analysis & Debugging**
- Analyze code for bugs, performance issues, and security vulnerabilities
- Explain error messages and suggest fixes
- Review code quality and suggest improvements

📚 **Learning & Documentation**
- Explain complex programming concepts and algorithms
- Provide code examples and best practices
- Help with API documentation and usage

🏗️ **Project Context Awareness**
- Work with attached files and understand project structure
- Provide contextual suggestions based on the current codebase
- Help integrate new code with existing architecture

**Response Guidelines:**
- Use markdown formatting for code blocks with appropriate language tags
- Provide clear, step-by-step explanations
- Include practical examples when helpful
- Be concise but comprehensive
- Format code blocks properly: \`\`\`language\ncode\n\`\`\`

${context ? '\n**Attached File Context:**\n' + context + '\n' : ''}`;

        const fullPrompt = `${systemPrompt}\n\n**User Request:** ${prompt}\n\n**Response:**`;

        const response = await genAI.models.generateContent({
            model: config.model,
            contents: fullPrompt
        });
        const text = response.text;
        
        if (!text) {
            throw new Error('Empty response from Google AI');
        }
        
        return text;
    } catch (error) {
        console.error('Google AI error:', error);
        throw error;
    }
}

export async function getAIResponse(
    prompt: string, 
    context: string = '', 
    config: AIConfig = DEFAULT_CONFIG
): Promise<string> {
    try {
        if (!prompt.trim()) {
            return 'Please provide a question or request.';
        }
        
        let response: string;
        
        switch (config.provider) {
            case 'google':
            default:
                response =await getGoogleAIResponse(prompt, context, config);
                break;
        }

        return response;
        
    } catch (error) {
        console.error('AI Service error:', error);
        return `❌ **Error**: ${error instanceof Error ? error.message : 'Unknown error occurred'}. Please try again.`;
    }
}

export { AIConfig, DEFAULT_CONFIG };
