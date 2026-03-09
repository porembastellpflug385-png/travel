import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, MicOff, Send, Plus, Trash2, Download, 
  PieChart, Users, DollarSign, AlertCircle, CheckCircle2,
  FileSpreadsheet, Loader2, Edit2, UserPlus
} from 'lucide-react';

// Placeholder for API Key. The environment will inject this at runtime.
const apiKey = "AIzaSyCThO5c1qtKnMnf-qCHnvXP3PP2ABwEsMk";

/**
 * Fetch wrapper with exponential backoff for API calls.
 */
const fetchWithRetry = async (url, options, retries = 5) => {
  const delays = [1000, 2000, 4000, 8000, 16000];
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP Error! Status: ${response.status}`);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delays[i]));
    }
  }
};

export default function App() {
  const [inputText, setInputText] = useState("");
  const [participants, setParticipants] = useState(""); // Pre-defined participant list
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [notification, setNotification] = useState(null);
  const [speechSupported, setSpeechSupported] = useState(true);
  
  const recognitionRef = useRef(null);

  // Initialize Speech Recognition
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
        console.error("Speech Recognition Error:", event.error);
        setIsRecording(false);
        if (event.error === 'not-allowed') {
          showNotification("麦克风权限被拒绝，请在浏览器中允许访问。", "error");
        } else {
          showNotification("语音识别出错，请重试。", "error");
        }
      };
      
      recognition.onend = () => setIsRecording(false);
      recognitionRef.current = recognition;
    } else {
      setSpeechSupported(false);
    }
  }, []);

  const toggleRecording = () => {
    if (!speechSupported) return showNotification("浏览器不支持语音输入", "error");
    if (isRecording) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
        showNotification("正在聆听，请描述费用...", "info");
      } catch (err) {
        setIsRecording(false);
      }
    }
  };

  const showNotification = (message, type = "info") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Process input using Gemini AI
  const processTextToData = async () => {
    if (!inputText.trim()) return showNotification("请输入费用描述", "error");

    setIsProcessing(true);
    try {
      const systemPrompt = `你是一个专业的差旅财务助手。
【关键信息】本次行程的已知参与人员名单为：[${participants || "未指定"}]。

你的任务：
1. 从描述中提取费用记录，返回 JSON 数组。
2. 字段要求：
   - name: 姓名。必须优先从名单中匹配。
   - category: 类别 ("交通", "住宿", "餐饮", "杂费", "其他")。
   - amount: 数字。
   - date: YYYY-MM-DD。
   - description: 详细描述。
3. 智能逻辑：
   - 若提到"我们"或"大家"，根据名单人数平摊费用。
   - 若名单只有一人，默认归属该人。
   - 识别口音可能导致的错别字，根据名单进行纠正。`;

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
        showNotification("AI 解析成功", "success");
      }
    } catch (error) {
      showNotification("解析失败，请检查网络或 API 配置", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // Calculate statistics
  const totalAmount = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const byPerson = expenses.reduce((acc, e) => {
    acc[e.name] = (acc[e.name] || 0) + Number(e.amount);
    return acc;
  }, {});

  // Export CSV with detail and summary
  const exportCSV = () => {
    if (expenses.length === 0) return;
    
    // Header and Rows
    const detailHeaders = ["姓名", "类别", "金额(元)", "日期", "描述事由"];
    const detailRows = expenses.map(e => [
      e.name, 
      e.category, 
      Number(e.amount).toFixed(2), 
      e.date || "-", 
      `"${e.description}"`
    ].join(","));
    
    // Summary Rows
    const summaryRows = [
      "", 
      "--- 结算汇总 ---", 
      "姓名,总计费用(元)"
    ];
    Object.entries(byPerson).forEach(([n, a]) => summaryRows.push(`${n},${a.toFixed(2)}`));
    summaryRows.push("");
    summaryRows.push(`所有费用总计,${totalAmount.toFixed(2)}`);

    const csvContent = "\uFEFF" + [detailHeaders.join(","), ...detailRows, ...summaryRows].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8' }));
    link.download = `费用结算单_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8 font-sans">
      <header className="max-w-6xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg text-white">
              <FileSpreadsheet size={24} />
            </div>
            智能差旅费用助手
          </h1>
          <p className="text-slate-500 text-sm mt-1 tracking-tight">Vercel 部署版 · 域名: travel.guantou.fun</p>
        </div>
        
        {notification && (
          <div className={`px-4 py-2 rounded-xl text-sm font-semibold shadow-sm transition-all duration-300 ${
            notification.type === 'error' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-blue-100 text-blue-700 border border-blue-200'
          }`}>
            {notification.message}
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Input & Settings */}
        <div className="space-y-6">
          {/* Participant Settings */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/60">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
              <UserPlus size={16} /> 1. 设置参与人员
            </h2>
            <input 
              type="text"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              placeholder="输入姓名，用空格分隔（如：张三 李四）"
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
            />
            <p className="text-[10px] text-slate-400 mt-2 italic">预设名单可大幅纠正语音识别中的同音字错误</p>
          </div>

          {/* Input Area */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/60">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
              <Mic size={16} /> 2. 录入流水描述
            </h2>
            <textarea
              className="w-full h-32 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all"
              placeholder="点击语音或直接打字。例如：'张三和李四打车花了80元'"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
            <div className="flex gap-3 mt-4">
              <button 
                onClick={toggleRecording} 
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-all ${
                  isRecording ? 'bg-red-500 text-white shadow-lg shadow-red-200 animate-pulse' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
                {isRecording ? "停止" : "语音输入"}
              </button>
              <button 
                onClick={processTextToData} 
                disabled={isProcessing || !inputText.trim()} 
                className="flex-[1.5] flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-all shadow-lg shadow-blue-200"
              >
                {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                AI 解析数据
              </button>
            </div>
          </div>

          {/* Quick Statistics */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">实况总览</span>
              <DollarSign size={20} className="text-blue-500" />
            </div>
            <div className="text-4xl font-black text-slate-900 mb-6">
              <span className="text-xl font-medium mr-1 text-slate-400">¥</span>
              {totalAmount.toFixed(2)}
            </div>
            <div className="space-y-3 pt-4 border-t border-slate-100">
              {Object.entries(byPerson).map(([name, amount]) => (
                <div key={name} className="flex justify-between items-center group">
                  <span className="text-sm font-medium text-slate-600">{name}</span>
                  <span className="text-sm font-bold text-slate-800">¥{amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Data Table */}
        <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-slate-200/60 overflow-hidden flex flex-col">
          <div className="p-6 border-b flex justify-between items-center bg-white sticky top-0 z-10">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              费用明细清单
              <span className="bg-slate-100 text-slate-500 text-[10px] px-2 py-0.5 rounded-full">{expenses.length} 条</span>
            </h3>
            <button 
              onClick={exportCSV} 
              disabled={expenses.length === 0} 
              className="flex items-center gap-2 text-xs font-bold text-blue-600 px-4 py-2 bg-blue-50 rounded-xl hover:bg-blue-100 disabled:opacity-30 transition-all"
            >
              <Download size={14} /> 导出报表 (含统计)
            </button>
          </div>
          
          <div className="flex-1 overflow-auto p-2">
            {expenses.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-300">
                <FileSpreadsheet size={48} className="mb-4 opacity-10" />
                <p className="text-sm">尚未有任何费用明细记录</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                  <tr>
                    <th className="px-6 py-4 text-left">姓名</th>
                    <th className="px-6 py-4 text-left">类别</th>
                    <th className="px-6 py-4 text-left">金额</th>
                    <th className="px-6 py-4 text-left">事由描述</th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {expenses.map((exp) => (
                    <tr key={exp.id} className="hover:bg-slate-50/80 transition-all group">
                      <td className="px-6 py-4 font-bold text-slate-700">{exp.name}</td>
                      <td className="px-6 py-4">
                        <span className="text-[10px] px-2 py-1 rounded-lg font-bold bg-slate-100 text-slate-500 uppercase">
                          {exp.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-black text-slate-900">¥{Number(exp.amount).toFixed(2)}</td>
                      <td className="px-6 py-4 text-slate-400 text-xs truncate max-w-[200px]">{exp.description}</td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => deleteItem(exp.id)}
                          className="p-2 text-slate-200 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          
          {/* Footer Summary in UI */}
          {expenses.length > 0 && (
            <div className="p-6 bg-slate-50 border-t border-slate-100">
              <div className="flex justify-between items-center text-xs font-bold text-slate-400 uppercase tracking-widest">
                <span>汇总完成</span>
                <span className="text-slate-900 text-lg italic">Travel Expenses Summary</span>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
