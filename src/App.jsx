import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, MicOff, Send, Plus, Trash2, Download, 
  PieChart, Users, DollarSign, AlertCircle, CheckCircle2,
  FileSpreadsheet, Loader2, Edit2, UserPlus
} from 'lucide-react';

// --- 配置区域 ---
const apiKey = "sk-gh2faPfTmPUNdlvydWntx2XlZ4UJ3fXpAiuObwzmA45RC8ci";
const apiUrl = "https://openai.1pix.fun/v1/chat/completions"; // 第三方转发地址
const modelName = "deepseek-v3.2-exp"; // 使用的模型名称
const appId = 'cube-travel-expense-v2';

/**
 * 带有指数退避重试机制的请求封装
 */
const fetchWithRetry = async (url, options, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
};

export default function App() {
  const [inputText, setInputText] = useState("");
  const [participants, setParticipants] = useState(""); // 预设参与人员名单
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [notification, setNotification] = useState(null);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [debugInfo, setDebugInfo] = useState(""); 
  
  const recognitionRef = useRef(null);

  // 初始化语音识别
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
        if (event.error === 'not-allowed') {
          showNotification("麦克风权限被拒绝，请检查浏览器设置。", "error");
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

  // 解析文本
  const processTextToData = async () => {
    setDebugInfo("");
    if (!apiKey) return showNotification("API Key 尚未配置", "error");
    if (!inputText.trim()) return showNotification("请输入费用描述", "error");

    setIsProcessing(true);
    try {
      const systemPrompt = `你是一个专业的差旅财务助手。
【关键信息】本次行程的已知参与人员名单为：[${participants || "未指定"}]。
你的任务是从描述中提取费用记录，必须严格返回 JSON 数组格式。
数组项结构：{"name": "姓名", "category": "交通/住宿/餐饮/杂费/其他", "amount": 数字, "date": "YYYY-MM-DD", "description": "描述"}。
注意：
1. 优先匹配名单姓名。
2. 若提到"我们"或"大家"，请按名单人数平摊金额并拆分多条记录。
3. 只能返回纯 JSON 数组，不要包含任何 Markdown 代码块标签或解释文字。`;

      const payload = {
        model: modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `费用描述如下：${inputText}` }
        ],
        temperature: 0.3
      };

      const result = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });

      let content = result.choices?.[0]?.message?.content || "";
      content = content.replace(/```json|```/g, "").trim();
      
      const parsedData = JSON.parse(content);
      if (Array.isArray(parsedData)) {
        setExpenses(prev => [...prev, ...parsedData.map(item => ({ ...item, id: crypto.randomUUID() }))]);
        // 修改点：不再执行 setInputText("")，保留输入框内容以便对账
        showNotification("解析成功", "success");
      }
    } catch (error) {
      console.error("AI processing error:", error);
      setDebugInfo(error.message);
      showNotification("解析失败", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // 数据统计
  const totalAmount = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const byPerson = expenses.reduce((acc, e) => {
    acc[e.name] = (acc[e.name] || 0) + Number(e.amount);
    return acc;
  }, {});

  // 导出 CSV (含总结)
  const exportCSV = () => {
    if (expenses.length === 0) return;
    const detailHeaders = ["姓名", "类别", "金额(元)", "日期", "描述事由"];
    const detailRows = expenses.map(e => [e.name, e.category, e.amount, e.date || "-", `"${e.description}"`].join(","));
    
    const summaryRows = ["", "--- 结算汇总 ---", "姓名,总计费用(元)"];
    Object.entries(byPerson).forEach(([n, a]) => summaryRows.push(`${n},${a.toFixed(2)}`));
    summaryRows.push(`所有费用总计,${totalAmount.toFixed(2)}`);

    const csvContent = "\uFEFF" + [detailHeaders.join(","), ...detailRows, ...summaryRows].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8' }));
    link.download = `行程费用结算单_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8 font-sans">
      <header className="max-w-6xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="bg-indigo-600 p-1.5 rounded-lg text-white">
              <FileSpreadsheet size={24} />
            </div>
            差旅费报销智能助手
          </h1>
          {/* 修改点：删除了原本显示代理信息的描述行 */}
        </div>
        
        {notification && (
          <div className={`px-4 py-2 rounded-xl text-sm font-semibold shadow-sm transition-all animate-in fade-in slide-in-from-top-4 duration-300 ${
            notification.type === 'error' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
          }`}>
            {notification.message}
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="space-y-6">
          {/* 1. 参与人员设置 */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/60">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
              <UserPlus size={16} /> 1. 设置参与人员
            </h2>
            <input 
              type="text"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              placeholder="例如：张三 李四 王五"
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
            />
          </div>

          {/* 2. 流水录入区 */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/60">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
              <Mic size={16} /> 2. 录入明细描述
            </h2>
            <textarea
              className="w-full h-32 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none transition-all"
              placeholder="点击语音按钮开始说话..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
            
            {debugInfo && (
              <div className="mt-2 p-3 bg-red-50 text-red-600 text-[10px] rounded-lg border border-red-100 break-all font-mono">
                Error: {debugInfo}
              </div>
            )}

            <div className="flex gap-3 mt-4">
              <button onClick={toggleRecording} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-all ${isRecording ? 'bg-red-500 text-white shadow-lg shadow-red-200 animate-pulse' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {isRecording ? <MicOff size={18} /> : <Mic size={18} />} {isRecording ? "停止" : "语音输入"}
              </button>
              <button onClick={processTextToData} disabled={isProcessing} className="flex-[1.5] flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-all shadow-lg shadow-indigo-200">
                {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} AI 智能解析
              </button>
            </div>
            {/* 提示信息：说明文字会保留 */}
            <p className="mt-3 text-[10px] text-slate-400 italic text-center">生成明细后内容将保留，方便对账与补充</p>
          </div>

          {/* 3. 统计 */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/60">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">总结</span>
              <DollarSign size={20} className="text-indigo-500" />
            </div>
            <div className="text-4xl font-black text-slate-900 mb-6 tracking-tighter">¥{totalAmount.toFixed(2)}</div>
            <div className="space-y-3 pt-4 border-t">
              {Object.entries(byPerson).map(([name, amount]) => (
                <div key={name} className="flex justify-between items-center group">
                  <span className="text-sm font-medium text-slate-600">{name}</span>
                  <span className="text-sm font-bold text-slate-800">¥{amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧数据展示区 */}
        <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-slate-200/60 overflow-hidden flex flex-col min-h-[500px]">
          <div className="p-6 border-b flex justify-between items-center bg-white sticky top-0 z-10">
            <h3 className="font-bold flex items-center gap-2">费用明细清单</h3>
            <button onClick={exportCSV} disabled={expenses.length === 0} className="text-xs font-bold text-indigo-600 px-4 py-2 bg-indigo-50 rounded-xl hover:bg-indigo-100 disabled:opacity-30 transition-all">导出报表 (含统计)</button>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {expenses.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-300 italic text-sm">暂无明细记录，请从左侧录入</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                  <tr>
                    <th className="px-6 py-4 text-left">姓名</th>
                    <th className="px-6 py-4 text-left">类别</th>
                    <th className="px-6 py-4 text-left">金额</th>
                    <th className="px-4 py-3 text-left">描述</th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {expenses.map((exp) => (
                    <tr key={exp.id} className="hover:bg-slate-50 transition-all group">
                      <td className="px-6 py-4 font-bold text-slate-700">{exp.name}</td>
                      <td className="px-6 py-4">
                        <span className="text-[10px] px-2 py-1 rounded-lg font-bold bg-slate-100 text-slate-500 uppercase">
                          {exp.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-black">¥{Number(exp.amount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs truncate max-w-[150px]">{exp.description}</td>
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => setExpenses(prev => prev.filter(i => i.id !== exp.id))} className="text-slate-200 hover:text-red-500 transition-all cursor-pointer">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
