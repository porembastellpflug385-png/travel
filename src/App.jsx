import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, MicOff, Send, Plus, Trash2, Download, 
  PieChart, Users, DollarSign, AlertCircle, CheckCircle2,
  FileSpreadsheet, Loader2, Edit2, UserPlus
} from 'lucide-react';

// API Key 占位符
const apiKey = "";

const fetchWithRetry = async (url, options, retries = 5) => {
  const delays = [1000, 2000, 4000, 8000, 16000];
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP 错误! 状态码: ${response.status}`);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delays[i]));
    }
  }
};

export default function App() {
  const [inputText, setInputText] = useState("");
  const [participants, setParticipants] = useState(""); // 新增：参与人员名单
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [notification, setNotification] = useState(null);
  const [speechSupported, setSpeechSupported] = useState(true);
  
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'zh-CN';
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results).map(result => result[0].transcript).join('');
        if (event.results[0].isFinal) {
          setInputText(prev => prev + transcript + " ");
        }
      };
      recognition.onerror = (event) => {
        setIsRecording(false);
        showNotification("识别出错，请检查权限", "error");
      };
      recognition.onend = () => setIsRecording(false);
      recognitionRef.current = recognition;
    } else {
      setSpeechSupported(false);
    }
  }, []);

  const toggleRecording = () => {
    if (!speechSupported) return showNotification("浏览器不支持语音", "error");
    if (isRecording) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
        showNotification("正在聆听...", "info");
      } catch (err) {
        setIsRecording(false);
      }
    }
  };

  const showNotification = (message, type = "info") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const processTextToData = async () => {
    if (!inputText.trim()) return showNotification("请输入费用描述", "error");

    setIsProcessing(true);
    try {
      const systemPrompt = `你是一个专业的差旅财务助手。
【关键信息】本次行程的已知参与人员名单为：[${participants || "未指定"}]。

你的任务：
1. 从描述中提取费用记录，返回 JSON 数组。
2. 字段：name (姓名), category (类别), amount (数字), date (YYYY-MM-DD), description (描述)。
3. 类别限制："交通", "住宿", "餐饮", "杂费", "其他"。
4. 匹配策略：请优先匹配上述名单中的姓名。如果名单中只有一个人，且描述没提名字，则归于该人。
5. 分摊逻辑：若描述为多人共同消费（如"我们三个人吃了300"），请根据名单或描述的人数平摊费用。
6. 如果参与人名单为空且描述未提人名，请用"团队"。`;

      const payload = {
        contents: [{ parts: [{ text: inputText }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: "application/json" }
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const result = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (jsonText) {
        const parsedData = JSON.parse(jsonText);
        setExpenses(prev => [...prev, ...parsedData.map(item => ({ ...item, id: crypto.randomUUID() }))]);
        setInputText("");
        showNotification("解析成功", "success");
      }
    } catch (error) {
      showNotification("解析失败", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const exportCSV = () => {
    if (expenses.length === 0) return;
    const detailHeaders = ["姓名", "类别", "金额(元)", "日期", "描述事由"];
    const detailRows = expenses.map(e => [e.name, e.category, e.amount, e.date || "-", `"${e.description}"`].join(","));
    
    // 汇总数据
    const byPerson = expenses.reduce((acc, e) => { acc[e.name] = (acc[e.name] || 0) + Number(e.amount); return acc; }, {});
    const summaryRows = ["", "--- 结算汇总 ---", "姓名,总计费用(元)"];
    Object.entries(byPerson).forEach(([n, a]) => summaryRows.push(`${n},${a.toFixed(2)}`));
    summaryRows.push(`所有费用总计,${expenses.reduce((s, e) => s + Number(e.amount), 0).toFixed(2)}`);

    const csvContent = "\uFEFF" + [detailHeaders.join(","), ...detailRows, ...summaryRows].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv' }));
    link.download = `费用报销单_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  const totalAmount = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const byPerson = expenses.reduce((acc, e) => {
    acc[e.name] = (acc[e.name] || 0) + Number(e.amount);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8">
      <header className="max-w-6xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg text-white"><FileSpreadsheet size={24} /></div>
            智能差旅明细助手
          </h1>
          <p className="text-slate-500 text-sm mt-1">先设定成员，再录入流水，准确率更高</p>
        </div>
        {notification && (
          <div className={`px-4 py-2 rounded-xl text-sm font-semibold shadow-sm ${notification.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
            {notification.message}
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="space-y-6">
          {/* 新增：人员名单输入栏 */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/60">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
              <UserPlus size={16} /> 参与人员名单
            </h2>
            <input 
              type="text"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="输入姓名，用空格或逗号分隔（如：张三 李四）"
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
            />
            <p className="text-[10px] text-slate-400 mt-2 italic">预设名单可大幅提升 AI 对人名的识别准确率</p>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/60">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
              <Mic size={16} /> 费用描述
            </h2>
            <textarea
              className="w-full h-32 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              placeholder="点击语音录入或打字..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
            <div className="flex gap-3 mt-4">
              <button onClick={toggleRecording} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-all ${isRecording ? 'bg-red-500 text-white shadow-lg shadow-red-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {isRecording ? <MicOff size={18} /> : <Mic size={18} />} {isRecording ? "停止" : "语音输入"}
              </button>
              <button onClick={processTextToData} disabled={isProcessing} className="flex-[1.5] flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-all shadow-lg shadow-blue-200">
                {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} AI 解析
              </button>
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">总费用</span>
              <DollarSign size={20} className="text-blue-500" />
            </div>
            <div className="text-4xl font-black text-slate-900 mb-6">
              <span className="text-xl font-medium mr-1 text-slate-400">¥</span>{totalAmount.toFixed(2)}
            </div>
            <div className="space-y-3 pt-4 border-t">
              {Object.entries(byPerson).map(([name, amount]) => (
                <div key={name} className="flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-600">{name}</span>
                  <span className="text-sm font-bold text-slate-800">¥{amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-slate-200/60 overflow-hidden flex flex-col">
          <div className="p-6 border-b flex justify-between items-center">
            <h3 className="font-bold">费用明细清单</h3>
            <button onClick={exportCSV} disabled={expenses.length === 0} className="text-xs font-bold text-blue-600 px-4 py-2 bg-blue-50 rounded-xl hover:bg-blue-100 disabled:opacity-30">
              导出报表 (含统计)
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                <tr>
                  <th className="px-6 py-4 text-left">姓名</th>
                  <th className="px-6 py-4 text-left">类别</th>
                  <th className="px-6 py-4 text-left">金额</th>
                  <th className="px-6 py-4 text-left">描述</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {expenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50 group">
                    <td className="px-6 py-4 font-bold">{exp.name}</td>
                    <td className="px-6 py-4"><span className="text-[10px] px-2 py-1 rounded bg-slate-100 text-slate-500">{exp.category}</span></td>
                    <td className="px-6 py-4 font-black">¥{Number(exp.amount).toFixed(2)}</td>
                    <td className="px-6 py-4 text-slate-400 text-xs truncate max-w-[200px]">{exp.description}</td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => setExpenses(prev => prev.filter(i => i.id !== exp.id))} className="text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
