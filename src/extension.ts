//Подключает API VS Code (vscode), модуль для работы с путями (path) и файловой системой (fs).
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

//Создаёт глобальное хранилище history — словарь, где ключом является URI файла (строка), а значением — массив записей TimelineItem
const history = new Map<string, vscode.TimelineItem[]>();
//sequence — счётчик для генерации уникальных ID записей
let sequence = 0;

// Описывает структуру записи для сохранения в JSON.
interface StoredEntry {
    id: string;
    label: string;
    timestamp: number;
    fileKey: string; // uri.toString()
}

//Возвращает путь к файлу .vscode/history.json в корне открытого проекта. Если проект не открыт — возвращает undefined.
function getHistoryFilePath(): string | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return undefined;
    }
    return path.join(workspaceFolder.uri.fsPath, '.vscode', 'history.json');
}

//При старте VS Code подгружает историю с диска в память, чтобы она пережила перезапуск
function loadHistoryFromDisk(history: Map<string, vscode.TimelineItem[]>) {
    const filePath = getHistoryFilePath();
    if (!filePath || !fs.existsSync(filePath)) {
        return;
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const stored: StoredEntry[] = JSON.parse(raw);
        for (const entry of stored) {
            // Восстанавливаем TimelineItem из плоской структуры
            const item = new vscode.TimelineItem(entry.label, entry.timestamp);
            item.id = entry.id;
            item.iconPath = new vscode.ThemeIcon('save');
            item.command = {
                command: 'vscode.open',
                title: 'Открыть файл',
                arguments: [vscode.Uri.parse(entry.fileKey)]
            };
            const arr = history.get(entry.fileKey) || [];
            arr.push(item);
            history.set(entry.fileKey, arr);
        }
    } catch (e) {
        console.error('Не удалось прочитать историю:', e);
    }
}

// Каждое сохранение файла сразу фиксируется на диске чтобы данные не потерядись при аварийном закрытии VS Code.
function appendToDisk(entry: StoredEntry) {
    const filePath = getHistoryFilePath();
    if (!filePath) {
        return;
    }
    try {
        // Создаём .vscode, если её нет
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        let stored: StoredEntry[] = [];
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            stored = JSON.parse(raw);
        }
        stored.push(entry);
        fs.writeFileSync(filePath, JSON.stringify(stored, null, 2), 'utf-8');
    } catch (e) {
        console.error('Не удалось записать историю:', e);
    }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "my-first-extension" is now active!');
    //Загружает историю с диска в Map.
    loadHistoryFromDisk(history);
    //Создаёт эмиттер для оповещения VS Code об изменениях.
	const changes = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
	const provider: vscode.TimelineProvider = {
        //говорит VS Code, чтобы он подписался на наш эмиттер, и видел изменения».
        onDidChangeTimeline: changes.event,
        //когда VS Code запрашивает историю для файла, достаёт её из Map
        provideTimeline(uri, options, token) {
            if (token.isCancellationRequested) {
                return;
            }
            // Возвращаем историю для запрошенного файла (или пустой массив)
            return {
                items: history.get(uri.toString()) ?? []
            };
        }
	};
    //Регистрирует провайдера в системе и добавляет в автоматическую диактивацию
	context.subscriptions.push(
        vscode.workspace.registerTimelineProvider('my-first-extension.saveHistory', 'Моя хроника', 'file', provider)
    );
	context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(document => {
            //Проверяет, что файл входит в проект (иначе игнорирует)
			if (!vscode.workspace.getWorkspaceFolder(document.uri)) {
                return;
            }
            //Создаёт TimelineItem с меткой «Сохранён ...» и текущим временем.
            const item = new vscode.TimelineItem(
                `Сохранён ${vscode.workspace.asRelativePath(document.uri)}`,
                Date.now()
            );
            //Присваивает уникальный ID (save-1, save-2…).
            item.id = `save-${++sequence}`;
            item.iconPath = new vscode.ThemeIcon('save');
            item.command = {
                command: 'vscode.open',
                title: 'Открыть файл',
                arguments: [document.uri]
            };

            // Добавляем в хранилище
            const key = document.uri.toString();
            const items = history.get(key) || [];
            items.unshift(item); // новые записи сверху
            history.set(key, items);
            appendToDisk({
                id: item.id!,
                label: item.label as string,
                timestamp: item.timestamp,
                fileKey: document.uri.toString()
            });
            // Сообщаем VS Code, что панель нужно обновить
            changes.fire(document.uri);
        })
    );
	context.subscriptions.push(changes);

    const showHistoryCommand = vscode.commands.registerCommand(
    'my-first-extension.showHistory',
    async () => {
        // 1. Получаем текущий открытый файл
        const editor = vscode.window.activeTextEditor;
        //если нет файла — предупреждает
        if (!editor) {
            vscode.window.showWarningMessage('Откройте файл, чтобы увидеть его хронику.');
            return;
        }

        const uri = editor.document.uri;
        const key = uri.toString();
        const entries = history.get(key) || [];

        // 2. Открываем Проводник
        await vscode.commands.executeCommand('workbench.view.explorer');

        // 3. Фокусируем Timeline
        try {
            await vscode.commands.executeCommand('timeline.focus');
        } catch {
        }

        //Показывает всплывающее уведомление с количеством записей.
        if (entries.length === 0) {
            vscode.window.showInformationMessage(
                `Хроника для «${vscode.workspace.asRelativePath(uri)}» пуста. Сохраните файл — появится запись.`
            );
        } else {
            vscode.window.showInformationMessage(
                `Хроника «${vscode.workspace.asRelativePath(uri)}»: ${entries.length} записей. Смотрите панель Timeline.`
            );
        }
    }
);

context.subscriptions.push(showHistoryCommand);
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('my-first-extension.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from my-first-extension!');
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
