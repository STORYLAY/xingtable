import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { FieldType, Column, Table, SearchReferenceFilter } from "../types";
import {
  ICONS,
  TAG_COLORS,
  TagColorKey,
  getTagColor,
  parseJsonArray,
} from "../constants";
import { Tooltip } from "./Tooltip";
import { generateSmartFormula, generateFieldOptions } from "../geminiService";
import ConfirmDialog from "./ConfirmDialog";
import { api } from "../services/api";
import { Select, SelectOption } from "./Select";
import { OptionColorPicker } from "./CellEditors";

export const DateTimePickerPopup: React.FC<{
  type: FieldType;
  isDateTime: boolean;
  value: string;
  onSelect: (val: string) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLDivElement | null>;
  rect?: DOMRect;
  rowId?: string;
  colId?: string;
}> = ({
  type,
  isDateTime,
  value,
  onSelect,
  onClose,
  anchorRef,
  rect,
  rowId,
  colId,
}) => {
  const [coords, setCoords] = useState({ top: 0, left: 0, calculated: false });
  const popupRef = useRef<HTMLDivElement>(null);

  // Initialize selected values
  const now = new Date();
  const init = useMemo(() => {
    let y = now.getFullYear();
    let m = now.getMonth();
    let d = now.getDate();
    let hr = now.getHours();
    let min = now.getMinutes();

    if (
      value &&
      value !== "current_date" &&
      value !== "current_datetime" &&
      value !== "current_time"
    ) {
      try {
        if (type === FieldType.TIME) {
          const [h, mi] = value.split(":").map(Number);
          if (!isNaN(h)) hr = h;
          if (!isNaN(mi)) min = mi;
        } else {
          const dateObj = new Date(value);
          if (!isNaN(dateObj.getTime())) {
            y = dateObj.getFullYear();
            m = dateObj.getMonth();
            d = dateObj.getDate();
            hr = dateObj.getHours();
            min = dateObj.getMinutes();
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
    return { year: y, month: m, day: d, hour: hr, minute: min };
  }, [value, type]);

  const [viewYear, setViewYear] = useState(init.year);
  const [viewMonth, setViewMonth] = useState(init.month);
  const [selectedDay, setSelectedDay] = useState(init.day);
  const [selectedHour, setSelectedHour] = useState(init.hour);
  const [selectedMinute, setSelectedMinute] = useState(init.minute);

  const [showYearSelect, setShowYearSelect] = useState(false);
  const [showMonthSelect, setShowMonthSelect] = useState(false);
  const yearsListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showYearSelect && yearsListRef.current) {
      const selectedEl = yearsListRef.current.querySelector(
        '[data-selected="true"]',
      );
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "center", behavior: "auto" });
      }
    }
  }, [showYearSelect]);

  // Position calculation
  useLayoutEffect(() => {
    const updatePosition = () => {
      if (popupRef.current) {
        let activeRect = rect;
        if (rowId && colId) {
          const el = document.querySelector(
            `[data-row-id="${rowId}"][data-col-id="${colId}"]`,
          );
          if (el) {
            activeRect = el.getBoundingClientRect();
          }
        }

        const popupWidth = popupRef.current.offsetWidth || 340;
        const popupHeight = popupRef.current.offsetHeight || 320;

        let top = 0;
        let left = 0;

        if (activeRect) {
          const shouldShowAbove =
            activeRect.bottom + popupHeight > window.innerHeight;
          top = shouldShowAbove
            ? Math.max(8, activeRect.top - popupHeight - 4)
            : Math.min(
                window.innerHeight - popupHeight - 8,
                activeRect.bottom + 4,
              );
          left = Math.min(activeRect.left, window.innerWidth - popupWidth - 8);
        } else if (anchorRef && anchorRef.current) {
          const anchorRect = anchorRef.current.getBoundingClientRect();
          // Position to the left of the anchor, shifted down by 50px to align with the options list
          left = anchorRect.left - popupWidth - 8;
          top = anchorRect.top + 50;

          // Overflow boundary check
          if (left < 8) {
            left = anchorRect.right + 8;
          }
        }

        if (left + popupWidth > window.innerWidth) {
          left = Math.max(8, window.innerWidth - popupWidth - 8);
        }
        if (top + popupHeight > window.innerHeight) {
          top = Math.max(8, window.innerHeight - popupHeight - 8);
        }

        // Apply a floor limit to guarantee popup is on-screen
        left = Math.max(8, left);
        top = Math.max(8, top);

        setCoords((prev) => {
          if (prev.top === top && prev.left === left && prev.calculated)
            return prev;
          return { top, left, calculated: true };
        });
      }
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    let observer: ResizeObserver | null = null;
    if (popupRef.current) {
      observer = new ResizeObserver(() => {
        updatePosition();
      });
      observer.observe(popupRef.current);
    }

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
      if (observer) observer.disconnect();
    };
  }, [anchorRef, rect, rowId, colId]);

  // Click outside listener
  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        (!anchorRef?.current || !anchorRef.current.contains(e.target as Node))
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouse);
    return () => document.removeEventListener("mousedown", handleMouse);
  }, [onClose, anchorRef]);

  // Calendar cells generation
  const days = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startDay = firstDay.getDay(); // 0 is Sunday, 1 is Monday...
    const startOffset = startDay === 0 ? 6 : startDay - 1; // start on Monday

    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevTotalDays = new Date(viewYear, viewMonth, 0).getDate();

    const cells = [];
    // Previous month padding
    for (let i = startOffset - 1; i >= 0; i--) {
      cells.push({
        dayNum: prevTotalDays - i,
        monthOffset: -1,
        isCurrent: false,
        dateObj: new Date(viewYear, viewMonth - 1, prevTotalDays - i),
      });
    }
    // Current month
    for (let i = 1; i <= totalDays; i++) {
      cells.push({
        dayNum: i,
        monthOffset: 0,
        isCurrent: true,
        dateObj: new Date(viewYear, viewMonth, i),
      });
    }
    // Next month padding to complete grid
    let nextNum = 1;
    while (cells.length < 42) {
      cells.push({
        dayNum: nextNum,
        monthOffset: 1,
        isCurrent: false,
        dateObj: new Date(viewYear, viewMonth + 1, nextNum++),
      });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleToday = () => {
    const d = new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setSelectedDay(d.getDate());
    setSelectedHour(d.getHours());
    setSelectedMinute(d.getMinutes());
    setShowYearSelect(false);
    setShowMonthSelect(false);
  };

  const handleConfirm = () => {
    if (type === FieldType.TIME) {
      const hStr = String(selectedHour).padStart(2, "0");
      const mStr = String(selectedMinute).padStart(2, "0");
      onSelect(`${hStr}:${mStr}`);
    } else {
      const yStr = String(viewYear);
      const mStr = String(viewMonth + 1).padStart(2, "0");
      const dStr = String(selectedDay).padStart(2, "0");
      if (isDateTime) {
        const hStr = String(selectedHour).padStart(2, "0");
        const minStr = String(selectedMinute).padStart(2, "0");
        onSelect(`${yStr}-${mStr}-${dStr}T${hStr}:${minStr}`);
      } else {
        onSelect(`${yStr}-${mStr}-${dStr}`);
      }
    }
    onClose();
  };

  // Scroll time into view when open
  const hourListRef = useRef<HTMLDivElement>(null);
  const minuteListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hourListRef.current) {
      const selectedEl = hourListRef.current.querySelector(
        '[data-selected="true"]',
      );
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "center", behavior: "auto" });
      }
    }
    if (minuteListRef.current) {
      const selectedEl = minuteListRef.current.querySelector(
        '[data-selected="true"]',
      );
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "center", behavior: "auto" });
      }
    }
  }, [selectedHour, selectedMinute]);

  const isToday = (date: Date) => {
    const t = new Date();
    return (
      date.getDate() === t.getDate() &&
      date.getMonth() === t.getMonth() &&
      date.getFullYear() === t.getFullYear()
    );
  };

  const portalContent = (
    <div
      ref={popupRef}
      style={{
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        visibility: coords.calculated ? "visible" : "hidden",
      }}
      className="fixed bg-white border border-gray-200 rounded-2xl shadow-2xl z-[99999] flex flex-col overflow-hidden text-sm w-fit select-none"
    >
      <div className="flex">
        {/* Calendar Grid Section */}
        {type !== FieldType.TIME && (
          <div className="p-4 w-[280px] relative">
            {/* Header Year/Month Selection */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-1 font-medium text-gray-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowYearSelect(!showYearSelect);
                    setShowMonthSelect(false);
                  }}
                  className="hover:bg-gray-100 hover:text-primary-600 px-1.5 py-0.5 rounded flex items-center gap-0.5 cursor-pointer transition-colors"
                >
                  <span>{viewYear}年</span>
                  <ICONS.ChevronDown
                    className={`w-3.5 h-3.5 text-gray-500 transition-transform duration-200 ${showYearSelect ? "rotate-180" : ""}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMonthSelect(!showMonthSelect);
                    setShowYearSelect(false);
                  }}
                  className="hover:bg-gray-100 hover:text-primary-600 px-1.5 py-0.5 rounded flex items-center gap-0.5 cursor-pointer transition-colors"
                >
                  <span>{viewMonth + 1}月</span>
                  <ICONS.ChevronDown
                    className={`w-3.5 h-3.5 text-gray-500 transition-transform duration-200 ${showMonthSelect ? "rotate-180" : ""}`}
                  />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={showYearSelect || showMonthSelect}
                  onClick={handlePrevMonth}
                  className={`w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded-full text-gray-500 transition-opacity ${
                    showYearSelect || showMonthSelect
                      ? "opacity-20 cursor-not-allowed"
                      : "cursor-pointer"
                  }`}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  disabled={showYearSelect || showMonthSelect}
                  onClick={handleNextMonth}
                  className={`w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded-full text-gray-500 transition-opacity ${
                    showYearSelect || showMonthSelect
                      ? "opacity-20 cursor-not-allowed"
                      : "cursor-pointer"
                  }`}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Weekdays Grid Headers */}
            <div className="grid grid-cols-7 gap-y-2 text-center text-xs font-medium text-gray-400 mb-2">
              {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>

            {/* Calendar Days Cells Grid */}
            <div className="grid grid-cols-7 gap-y-1 text-center">
              {days.map((cell, idx) => {
                const today = isToday(cell.dateObj);
                const active = cell.isCurrent && cell.dayNum === selectedDay;

                return (
                  <div
                    key={idx}
                    className="flex justify-center items-center py-0.5"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (cell.monthOffset === -1) {
                          handlePrevMonth();
                        } else if (cell.monthOffset === 1) {
                          handleNextMonth();
                        }
                        setSelectedDay(cell.dayNum);
                      }}
                      className={`
                        w-8 h-8 rounded-full flex items-center justify-center text-xs transition-colors cursor-pointer
                        ${!cell.isCurrent ? "text-gray-300" : "text-gray-700"}
                        ${active ? "bg-primary-600 text-white font-semibold hover:bg-primary-700" : "hover:bg-gray-100"}
                        ${today && !active ? "border border-primary-600 text-primary-600" : ""}
                      `}
                    >
                      {cell.dayNum}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Year Selector Overlay */}
            {showYearSelect && (
              <div className="absolute top-12 left-0 right-0 bottom-0 bg-white z-10 px-4 py-2 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    选择年份
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowYearSelect(false)}
                    className="text-xs text-primary-600 hover:text-primary-700 font-semibold cursor-pointer"
                  >
                    取消
                  </button>
                </div>
                <div
                  ref={yearsListRef}
                  className="grid grid-cols-3 gap-1.5 overflow-y-auto max-h-[170px] pr-1 scroll-smooth"
                  style={{ scrollbarWidth: "thin" }}
                >
                  {Array.from(
                    { length: 101 },
                    (_, i) => now.getFullYear() - 50 + i,
                  ).map((y) => (
                    <button
                      type="button"
                      key={y}
                      data-selected={y === viewYear}
                      onClick={() => {
                        setViewYear(y);
                        setShowYearSelect(false);
                      }}
                      className={`py-1 text-xs rounded-lg transition-all cursor-pointer ${
                        y === viewYear
                          ? "bg-primary-600 text-white font-bold shadow-sm"
                          : "hover:bg-gray-100 text-gray-700 hover:text-primary-600"
                      }`}
                    >
                      {y}年
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Month Selector Overlay */}
            {showMonthSelect && (
              <div className="absolute top-12 left-0 right-0 bottom-0 bg-white z-10 px-4 py-2 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    选择月份
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowMonthSelect(false)}
                    className="text-xs text-primary-600 hover:text-primary-700 font-semibold cursor-pointer"
                  >
                    取消
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 py-1">
                  {Array.from({ length: 12 }, (_, i) => i).map((m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => {
                        setViewMonth(m);
                        setShowMonthSelect(false);
                      }}
                      className={`py-2 text-xs rounded-lg transition-all cursor-pointer ${
                        m === viewMonth
                          ? "bg-primary-600 text-white font-bold shadow-sm"
                          : "hover:bg-gray-100 text-gray-700 hover:text-primary-600"
                      }`}
                    >
                      {m + 1}月
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Time Columns Pickers List Panel (Hour & Minute) */}
        {(type === FieldType.TIME || isDateTime) && (
          <div className="flex border-l border-gray-100 p-3 bg-gray-50/30">
            {/* Hours Column */}
            <div className="flex flex-col items-center w-14">
              <span className="text-xs font-medium text-gray-400 mb-2">时</span>
              <div
                ref={hourListRef}
                className="w-full h-[220px] overflow-y-auto overflow-x-hidden text-center flex flex-col gap-0.5 select-none scroll-smooth pr-1"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                {Array.from({ length: 24 }).map((_, h) => (
                  <button
                    type="button"
                    key={h}
                    data-selected={selectedHour === h}
                    onClick={() => setSelectedHour(h)}
                    className={`
                      w-full py-1 text-xs rounded-md transition-all cursor-pointer hover:bg-gray-100 shrink-0
                      ${selectedHour === h ? "bg-primary-50 text-primary-600 font-bold" : "text-gray-600"}
                    `}
                  >
                    {String(h).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>

            {/* Minutes Column */}
            <div className="flex flex-col items-center w-14 border-l border-gray-100 ml-1">
              <span className="text-xs font-medium text-gray-400 mb-2">分</span>
              <div
                ref={minuteListRef}
                className="w-full h-[220px] overflow-y-auto overflow-x-hidden text-center flex flex-col gap-0.5 select-none scroll-smooth pl-1"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                {Array.from({ length: 60 }).map((_, m) => (
                  <button
                    type="button"
                    key={m}
                    data-selected={selectedMinute === m}
                    onClick={() => setSelectedMinute(m)}
                    className={`
                      w-full py-1 text-xs rounded-md transition-all cursor-pointer hover:bg-gray-100 shrink-0
                      ${selectedMinute === m ? "bg-primary-50 text-primary-600 font-bold" : "text-gray-600"}
                    `}
                  >
                    {String(m).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Buttons Section */}
      <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/50 flex justify-between items-center shrink-0">
        <button
          type="button"
          onClick={handleToday}
          className="text-xs font-semibold text-primary-600 hover:text-primary-700 flex items-center cursor-pointer"
        >
          {type === FieldType.TIME ? "当前时间" : "今天"}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-xl text-xs font-medium cursor-pointer transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-sm transition-colors"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(portalContent, document.body);
};

interface FieldConfigDialogProps {
  tableId: string;
  column?: Column;
  allColumns?: Column[]; // 用于公式编辑时提供可用列参考
  allTables?: Table[]; // 用于关联字段选择表
  isVisible?: boolean; // 当前在视图中是否可见
  anchorEl?: HTMLElement | null | { top: number; left: number };
  mode?: "modal" | "popover";
  onClose: () => void;
  onSave: (
    column: Column,
    isVisible: boolean,
    optionRenames?: Record<string, string>,
    deletedOptions?: string[],
  ) => void | Promise<void>;
  onDelete?: (colId: string) => boolean | Promise<boolean>;
}

// Fallback if API fails
const FIELD_TYPE_LABELS_DEFAULT: Record<string, string> = {
  [FieldType.TEXT]: "文本",
  [FieldType.NUMBER]: "数字",
  [FieldType.SELECT]: "单选",
  [FieldType.MULTI_SELECT]: "多选",
  [FieldType.DATE]: "日期",
  [FieldType.TIME]: "时间",
  [FieldType.CHECKBOX]: "复选框",
  [FieldType.FORMULA]: "公式",
  [FieldType.ATTACHMENT]: "附件",
  [FieldType.USER]: "人员",
  [FieldType.DEPARTMENT]: "部门",
  [FieldType.GROUP]: "群组",
  [FieldType.LINK]: "关联引用",
  [FieldType.HYPERLINK]: "超链接",
  [FieldType.LOOKUP]: "引用 (Lookup)",
  [FieldType.SEARCH_REFERENCE]: "查找引用",
};

const NUMBER_FORMATS = [
  { label: "整数 (1)", value: "0" },
  { label: "保留一位小数 (1.0)", value: "0.0" },
  { label: "保留两位小数 (1.00)", value: "0.00" },
  { label: "百分比 (100%)", value: "0%" },
  { label: "货币 (¥1.00)", value: "¥0.00" },
];

const DATE_FORMATS = [
  { label: "年-月-日 (2024-05-20)", value: "YYYY-MM-DD" },
  { label: "年/月/日 (2024/05/20)", value: "YYYY/MM/DD" },
  { label: "月/日/年 (05/20/2024)", value: "MM/DD/YYYY" },
  { label: "时间 (2024-05-20 14:30)", value: "YYYY-MM-DD HH:mm" },
];

const TIME_FORMATS = [
  { label: "时 (HH)", value: "HH" },
  { label: "时分 (HH:mm)", value: "HH:mm" },
  { label: "时分秒 (HH:mm:ss)", value: "HH:mm:ss" },
];

const UserSelector = ({
  value,
  onChange,
  onClose,
}: {
  value: any;
  onChange: (val: any) => void;
  onClose: () => void;
}) => {
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");

  // Normalize value to array
  const selectedUsers = useMemo(() => {
    const arr = Array.isArray(value) ? value : value ? [value] : [];
    return arr.filter(
      (u) => u !== null && u !== undefined && u !== "" && u !== "[]",
    );
  }, [value]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.getMembers({ name: keyword });
        setMembers(res.accounts || []);
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    };
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  const toggleUser = (user: any) => {
    const exists = selectedUsers.find((u: any) => u.id === user.id);
    let newSel;
    if (exists) {
      newSel = selectedUsers.filter((u: any) => u.id !== user.id);
    } else {
      newSel = [
        ...selectedUsers,
        { id: user.id, name: user.name, real_name: user.real_name },
      ];
    }
    onChange(newSel);
  };

  return (
    <div className="absolute top-full left-0 mt-1 w-full bg-white border border-gray-200 shadow-xl rounded-lg z-[120] flex flex-col overflow-hidden">
      <div className="p-2 border-b border-gray-100 flex items-center gap-2">
        <input
          className="flex-1 text-xs px-2 py-1 bg-gray-50 border border-gray-200 rounded outline-none focus:border-primary-500"
          placeholder="搜索成员..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          autoFocus
        />
        <Tooltip
          content="关闭"
          className="shrink-0 flex items-center justify-center"
        >
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <ICONS.Close className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
      <div className="max-h-48 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="p-2 text-center text-gray-400 text-xs">加载中...</div>
        ) : members.length > 0 ? (
          members.map((m) => {
            const isSel = selectedUsers.some((u: any) => u.id === m.id);
            return (
              <div
                key={m.id}
                className={`flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm ${isSel ? "bg-primary-50" : ""}`}
                onClick={() => toggleUser(m)}
              >
                <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden shrink-0 text-xs text-gray-500 font-medium">
                  {m.avatar_url || m.avatar ? (
                    <img
                      src={m.avatar_url || m.avatar}
                      className="w-full h-full object-cover"
                      alt=""
                    />
                  ) : (
                    (m.real_name || m.name)?.[0] || "U"
                  )}
                </div>
                <span className="truncate flex-1 text-gray-700">
                  {m.real_name || m.name}
                  {m.real_name && m.name && m.real_name !== m.name && (
                    <span className="text-gray-400 ml-1">({m.name})</span>
                  )}
                </span>
                {isSel && (
                  <svg
                    className="w-3 h-3 text-primary-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
            );
          })
        ) : (
          <div className="p-2 text-center text-gray-400 text-xs">无结果</div>
        )}
      </div>
    </div>
  );
};

const DepartmentSelector = ({
  value,
  onChange,
  onClose,
}: {
  value: any;
  onChange: (val: any) => void;
  onClose: () => void;
}) => {
  const [depts, setDepts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");

  // Normalize value to array
  const selectedDepts = React.useMemo(() => {
    const arr = Array.isArray(value) ? value : value ? [value] : [];
    return arr.map((d) => {
      if (typeof d === "object" && d !== null) return d;
      return { id: d, name: "Dept " + d };
    });
  }, [value]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.getDepts();
        setDepts(res.data || []);
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    };
    load();
  }, []);

  const filteredDepts = depts.filter((d) => {
    const name = d.name || d.dept_name || "";
    return name.toLowerCase().includes(keyword.toLowerCase());
  });

  const toggleDept = (dept: any) => {
    const deptId = dept.id || dept.dept_id;
    const deptName = dept.name || dept.dept_name;
    const exists = selectedDepts.find((d: any) => d.id === deptId);
    let newSel;
    if (exists) {
      newSel = selectedDepts.filter((d: any) => d.id !== deptId);
    } else {
      newSel = [...selectedDepts, { id: deptId, name: deptName }];
    }
    onChange(newSel);
  };

  return (
    <div className="absolute top-full left-0 mt-1 w-full bg-white border border-gray-200 shadow-xl rounded-lg z-[120] flex flex-col overflow-hidden">
      <div className="p-2 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-bold text-gray-500">选择部门</span>
        <Tooltip
          content="关闭"
          className="shrink-0 flex items-center justify-center"
        >
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <ICONS.Close className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
      <div className="p-2 border-b border-gray-50">
        <input
          className="w-full text-xs px-2 py-1 bg-gray-50 border border-gray-200 rounded outline-none focus:border-primary-500"
          placeholder="搜索部门..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          autoFocus
        />
      </div>
      <div className="max-h-48 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="p-2 text-center text-gray-400 text-xs">加载中...</div>
        ) : filteredDepts.length > 0 ? (
          filteredDepts.map((d) => {
            const deptId = d.id || d.dept_id;
            const deptName = d.name || d.dept_name;
            const isSel = selectedDepts.some((sel: any) => sel.id === deptId);
            return (
              <div
                key={deptId}
                className={`flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm ${isSel ? "bg-primary-50" : ""}`}
                onClick={() => toggleDept(d)}
              >
                <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center shrink-0 text-gray-500">
                  <ICONS.Building className="w-3.5 h-3.5" />
                </div>
                <span className="truncate flex-1 text-gray-700">
                  {deptName}
                </span>
                {isSel && (
                  <svg
                    className="w-3 h-3 text-primary-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
            );
          })
        ) : (
          <div className="p-2 text-center text-gray-400 text-xs">无结果</div>
        )}
      </div>
    </div>
  );
};

const FieldConfigDialog: React.FC<FieldConfigDialogProps> = ({
  tableId,
  column,
  allColumns = [],
  allTables = [],
  isVisible = true,
  anchorEl,
  mode = "modal",
  onClose,
  onSave,
  onDelete,
}) => {
  const [name, setName] = useState(column?.name || "新字段");
  const [type, setType] = useState<string>(column?.type || FieldType.TEXT);
  // Update: options are now in config
  const [options, setOptions] = useState<string[]>(
    column?.config?.options || [],
  );
  const [optionRenames, setOptionRenames] = useState<Record<string, string>>(
    {},
  );
  const [deletedOptions, setDeletedOptions] = useState<string[]>([]);
  // Update: optionColors are now in config
  const [optionColors, setOptionColors] = useState<Record<string, string>>(
    column?.config?.option_colors || {},
  );

  // Use config.defaultValue if available, fallback to root
  const [defaultValue, setDefaultValue] = useState<any>(
    column?.config?.defaultValue ?? column?.defaultValue ?? "",
  );

  const [format, setFormat] = useState(
    column?.config?.format || column?.format || "",
  );
  const [formula, setFormula] = useState(
    column?.config?.formula || column?.formula || "",
  );
  // Update: linkedTableId is now in config
  const [linkedTableId, setLinkedTableId] = useState(
    column?.config?.linked_table_id || "",
  );
  const [visible, setVisible] = useState(isVisible);

  // Lookup specific states (now in config)
  const [lookupRelationColId, setLookupRelationColId] = useState(
    column?.config?.lookup_relation_col_id || "",
  );
  const [lookupTargetColId, setLookupTargetColId] = useState(
    column?.config?.lookup_target_col_id || "",
  );

  // Search Reference Specific States (now in config)
  const [queryTargetTableId, setQueryTargetTableId] = useState(
    column?.config?.search_reference_config?.target_table_id ||
      column?.config?.target_table_id ||
      "",
  );
  const [queryTargetFieldId, setQueryTargetFieldId] = useState(
    column?.config?.search_reference_config?.target_field_id ||
      column?.config?.target_field_id ||
      "",
  );
  const [queryFilters, setQueryFilters] = useState<SearchReferenceFilter[]>(
    column?.config?.search_reference_config?.filters || [
      {
        target_condition_field_id: column?.config?.match_target_field_id || "",
        operator: "EQ",
        current_field_id: column?.config?.match_current_field_id || "",
      },
    ],
  );
  const [searchConditions, setSearchConditions] = useState<
    { label: string; value: string }[]
  >([]);
  const [targetTableColumns, setTargetTableColumns] = useState<Column[]>([]);

  const dateContainerRef = React.useRef<HTMLDivElement>(null);
  const timeContainerRef = React.useRef<HTMLDivElement>(null);
  const [isDateSelectOpen, setIsDateSelectOpen] = useState(false);
  const [isTimeSelectOpen, setIsTimeSelectOpen] = useState(false);
  const [isDateCalendarOpen, setIsDateCalendarOpen] = useState(false);
  const [isTimeCalendarOpen, setIsTimeCalendarOpen] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dateContainerRef.current &&
        !dateContainerRef.current.contains(e.target as Node)
      ) {
        setIsDateSelectOpen(false);
      }
      if (
        timeContainerRef.current &&
        !timeContainerRef.current.contains(e.target as Node)
      ) {
        setIsTimeSelectOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    // Fetch search conditions on mount to ensure Interface 54 is called
    const fetchConditions = async () => {
      try {
        const res = await api.getSearchConditions();
        if (res.data) setSearchConditions(res.data);
      } catch (err) {
        console.error("Failed to fetch search conditions", err);
      }
    };
    fetchConditions();
  }, []);

  useEffect(() => {
    // Re-fetch if type is SEARCH_REFERENCE and we don't have conditions yet
    if (type === FieldType.SEARCH_REFERENCE && searchConditions.length === 0) {
      api
        .getSearchConditions()
        .then((res) => {
          if (res.data) setSearchConditions(res.data);
        })
        .catch((err) =>
          console.error("Failed to fetch search conditions", err),
        );
    }
  }, [type, searchConditions.length]);

  useEffect(() => {
    let targetId = "";
    if (type === FieldType.SEARCH_REFERENCE) {
      targetId = queryTargetTableId;
    } else if (type === FieldType.LOOKUP) {
      const linkFields = allColumns.filter((c) => c.type === FieldType.LINK);
      const selectedRelation = linkFields.find(
        (c) => c.id === lookupRelationColId,
      );
      targetId = selectedRelation?.config?.linked_table_id || "";
    }

    if (targetId) {
      api
        .getColumns(targetId)
        .then((res) => {
          if (res.data) setTargetTableColumns(res.data);
        })
        .catch((err) =>
          console.error("Failed to fetch target table columns", err),
        );
    } else {
      setTargetTableColumns([]);
    }
  }, [type, queryTargetTableId, lookupRelationColId, allColumns]);

  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [isAiOptionsLoading, setIsAiOptionsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  // AI Models State
  const [aiModels, setAiModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<{
    provider: string;
    model: string;
  } | null>(null);
  const [isModelsLoading, setIsModelsLoading] = useState(false);

  // Field Types from API
  const [fieldTypes, setFieldTypes] = useState<
    { label: string; value: string }[]
  >([]);

  useEffect(() => {
    // Fetch dynamic field types from API
    const loadTypes = async () => {
      try {
        const res = await api.getFieldTypes();
        if (res.data && Array.isArray(res.data)) {
          setFieldTypes(res.data);
        }
      } catch (e) {
        console.warn(
          "Failed to fetch field types from API, using local defaults.",
        );
        // Fallback
        setFieldTypes(
          Object.entries(FIELD_TYPE_LABELS_DEFAULT).map(([val, label]) => ({
            value: val,
            label,
          })),
        );
      }
    };
    loadTypes();

    // Fetch AI Models
    const loadModels = async () => {
      setIsModelsLoading(true);
      try {
        const res = await api.getModels();
        if (res.data && Array.isArray(res.data)) {
          setAiModels(res.data);
          // Select first available model by default
          for (const provider of res.data) {
            if (provider.models && provider.models.length > 0) {
              setSelectedModel({
                provider: provider.provider,
                model: provider.models[0].model,
              });
              break;
            }
          }
        }
      } catch (e) {
        console.error("Failed to load AI models", e);
      } finally {
        setIsModelsLoading(false);
      }
    };
    loadModels();
  }, []);

  // 默认格式初始化
  useEffect(() => {
    if (!format) {
      if (type === FieldType.NUMBER) setFormat(NUMBER_FORMATS[0].value);
      if (type === FieldType.DATE) setFormat(DATE_FORMATS[0].value);
      if (type === FieldType.TIME) setFormat(TIME_FORMATS[1].value); // Default to HH:mm
    }
  }, [type, format]);

  // 默认关联表初始化
  useEffect(() => {
    if (type === FieldType.LINK && !linkedTableId && allTables.length > 0) {
      setLinkedTableId(allTables[0].id);
    }
  }, [type, linkedTableId, allTables]);

  // Check if primary column (usually the first one)
  const isPrimary = allColumns.length > 0 && column?.id === allColumns[0].id;

  const handleAddOption = () => {
    setOptions([...options, ""]);
  };

  // 获取选项颜色样式
  const getOptionColorStyle = (opt: string) => {
    const colorStyle = getTagColor(opt, optionColors);
    return colorStyle.bg;
  };

  const handleOptionChange = (idx: number, newVal: string) => {
    const oldVal = options[idx];
    const newOpts = [...options];
    newOpts[idx] = newVal;
    setOptions(newOpts);

    if (oldVal && oldVal !== newVal) {
      if (optionColors[oldVal]) {
        setOptionColors((prev) => {
          const newColors = { ...prev };
          newColors[newVal] = newColors[oldVal];
          delete newColors[oldVal];
          return newColors;
        });
      }
      setOptionRenames((prev) => {
        const newRenames = { ...prev };
        const originalKey = Object.keys(newRenames).find(
          (k) => newRenames[k] === oldVal,
        );
        if (originalKey) {
          newRenames[originalKey] = newVal;
        } else {
          newRenames[oldVal] = newVal;
        }
        return newRenames;
      });
    }
  };

  const handleDeleteOption = (idx: number) => {
    const valToDelete = options[idx];
    setOptions(options.filter((_, i) => i !== idx));
    if (valToDelete) {
      const originalKey = Object.keys(optionRenames).find(
        (k) => optionRenames[k] === valToDelete,
      );
      const valToAdd = originalKey ? originalKey : valToDelete;
      if (column?.config?.options?.includes(valToAdd)) {
        setDeletedOptions((prev) => [...prev, valToAdd]);
      }
      if (originalKey) {
        setOptionRenames((prev) => {
          const newRenames = { ...prev };
          delete newRenames[originalKey];
          return newRenames;
        });
      }
    }
  };

  const handleAiGenerateFormula = async () => {
    if (!aiPrompt || !selectedModel) {
      if (!selectedModel) alert("请先选择 AI 模型");
      return;
    }
    setIsAiGenerating(true);
    try {
      const res = await api.generateContent({
        provider: selectedModel.provider,
        model: selectedModel.model,
        content: `作为一名专家级电子表格工程师，请帮助用户编写公式。\n    可用列：${allColumns.map((c) => `${c.name} (${c.type})`).join(", ")}。\n    用户需求：${aiPrompt}。\n    仅返回公式字符串（例如："{单价} * {数量}"）。不要添加任何解释说明。`,
        role: "user",
      });
      if (res.content) {
        // Remove any markdown code blocks if present
        let cleanFormula = res.content.replace(/```/g, "").trim();
        setFormula(cleanFormula);
      }
    } catch (error) {
      console.error("AI Formula generation failed", error);
      alert("AI 生成公式失败，请稍后重试");
    } finally {
      setIsAiGenerating(false);
    }
  };

  const handleAiGenerateOptions = async () => {
    if (!name || !selectedModel) {
      if (!selectedModel) alert("请先选择 AI 模型");
      return;
    }
    setIsAiOptionsLoading(true);
    try {
      const res = await api.generateContent({
        provider: selectedModel.provider,
        model: selectedModel.model,
        content: `用户正在创建一个名为"${name}"的单选或多选字段。\n    请根据字段名称生成 5-10 个合理的选项值。\n    仅返回选项列表，用逗号分隔，不要包含任何其他文字或编号。\n    例如：如果字段名是"优先级"，返回"最高, 高, 中, 低, 最低"。`,
        role: "user",
      });

      if (res.content) {
        const generatedOptions = res.content
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter((s) => s);
        if (generatedOptions.length > 0) {
          setOptions(generatedOptions);
        } else {
          alert("AI 未能生成有效选项，请尝试更明确的字段名称");
        }
      }
    } catch (error) {
      console.error("AI Options generation failed", error);
      alert("AI 生成选项失败，请稍后重试");
    } finally {
      setIsAiOptionsLoading(false);
    }
  };

  const renderModelSelector = () => {
    const options: SelectOption[] = isModelsLoading
      ? [{ label: "加载模型中...", value: "" }]
      : aiModels.flatMap((provider: any) =>
          (provider.models || []).map((model: any) => {
            const modelId = model.model || "";
            const modelLabel = model.label?.zh_Hans || modelId;
            const hasVisionFeature =
              Array.isArray(model.features) &&
              model.features.some(
                (f: any) =>
                  typeof f === "string" && f.toLowerCase().includes("vision"),
              );
            const contains4v =
              modelId.toLowerCase().includes("4v") ||
              modelLabel.toLowerCase().includes("4v");
            const isVision = hasVisionFeature || contains4v;

            return {
              label: modelLabel,
              value: `${provider.provider}:${modelId}`,
              group: provider.label?.zh_Hans || provider.provider,
              icon: provider.icon_small?.zh_Hans,
              mode: model.model_properties?.mode,
              isVision: isVision,
            };
          }),
        );

    return (
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[10px] font-bold text-gray-400 uppercase shrink-0">
          AI 模型
        </label>
        <div className="flex-1">
          <Select
            options={options}
            value={
              selectedModel
                ? `${selectedModel.provider}:${selectedModel.model}`
                : ""
            }
            onChange={(val) => {
              if (!val) return;
              const [p, m] = val.split(":");
              setSelectedModel({ provider: p, model: m });
            }}
            disabled={isModelsLoading}
            triggerClassName="w-full min-h-[28px] px-2 py-1 bg-white border rounded flex items-center justify-between transition-all duration-200 text-xs shadow-sm"
            portal={true}
            isModelSelector={true}
          />
        </div>
      </div>
    );
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const cleanOptionColors: Record<string, string> = {};
      if (
        [FieldType.SELECT, FieldType.MULTI_SELECT].includes(type as FieldType)
      ) {
        options.forEach((opt) => {
          if (optionColors[opt]) {
            cleanOptionColors[opt] = optionColors[opt];
          }
        });
      }

      // Construct the config object, merging with existing keys to prevent data loss if any
      const existingConfig = column?.config || {};

      // Masquerade DEPARTMENT as TEXT for backend compatibility
      let finalType = type;
      if (type === FieldType.DEPARTMENT) {
        finalType = FieldType.TEXT;
      }

      const newConfig = {
        ...existingConfig,
        originalType:
          type === FieldType.DEPARTMENT ? FieldType.DEPARTMENT : undefined,
        options: [FieldType.SELECT, FieldType.MULTI_SELECT].includes(
          type as FieldType,
        )
          ? options
          : undefined,
        option_colors: [FieldType.SELECT, FieldType.MULTI_SELECT].includes(
          type as FieldType,
        )
          ? cleanOptionColors
          : undefined,
        linked_table_id: type === FieldType.LINK ? linkedTableId : undefined,
        lookup_relation_col_id:
          type === FieldType.LOOKUP ? lookupRelationColId : undefined,
        lookup_target_col_id:
          type === FieldType.LOOKUP ? lookupTargetColId : undefined,
        search_reference_config:
          type === FieldType.SEARCH_REFERENCE
            ? {
                target_table_id: queryTargetTableId,
                target_field_id: queryTargetFieldId,
                filters: queryFilters,
              }
            : undefined,
        // Legacy fields for backward compatibility (required by backend)
        target_table_id:
          type === FieldType.SEARCH_REFERENCE ? queryTargetTableId : undefined,
        target_field_id:
          type === FieldType.SEARCH_REFERENCE ? queryTargetFieldId : undefined,
        match_target_field_id:
          type === FieldType.SEARCH_REFERENCE
            ? queryFilters[0]?.target_condition_field_id
            : undefined,
        match_current_field_id:
          type === FieldType.SEARCH_REFERENCE
            ? queryFilters[0]?.current_field_id
            : undefined,

        // Save defaultValue in config
        defaultValue: defaultValue,
        // Save format in config
        format: [FieldType.NUMBER, FieldType.DATE, FieldType.TIME].includes(
          type as FieldType,
        )
          ? format
          : undefined,
        // Save formula in config
        formula: type === FieldType.FORMULA ? formula : undefined,
      };

      await onSave(
        {
          id: column?.id || `c${Date.now()}`,
          name,
          type: finalType as FieldType,
          width: column?.width || 150,
          sort: column?.sort,
          defaultValue: defaultValue, // Keep top-level for frontend if needed
          format: [FieldType.NUMBER, FieldType.DATE, FieldType.TIME].includes(
            type as FieldType,
          )
            ? format
            : undefined,
          formula: type === FieldType.FORMULA ? formula : undefined,
          config: newConfig,
        },
        visible,
        optionRenames,
        deletedOptions,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    setShowConfirmDelete(true);
  };

  const confirmDelete = () => {
    if (column && onDelete && !isPrimary) {
      onDelete(column.id); // Direct call, handled by parent state update
      onClose();
    }
    setShowConfirmDelete(false);
  };

  const renderTypeSpecificConfigs = () => {
    switch (type) {
      case FieldType.NUMBER:
        return (
          <section>
            <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">
              数据格式
            </label>
            <Select
              portal={true}
              options={NUMBER_FORMATS}
              value={format}
              onChange={(val) => setFormat(val)}
            />
          </section>
        );
      case FieldType.DATE:
        return (
          <section>
            <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">
              日期显示格式
            </label>
            <Select
              portal={true}
              options={DATE_FORMATS}
              value={format}
              onChange={(val) => {
                setFormat(val);
                // Adjust defaultValue to match format style (date vs datetime-local) only if it's already a specific date string
                if (
                  defaultValue &&
                  defaultValue !== "current_date" &&
                  defaultValue !== "current_datetime"
                ) {
                  const isDateTime = val.includes("HH:mm");
                  if (isDateTime && !defaultValue.includes("T")) {
                    setDefaultValue(`${defaultValue}T12:00`);
                  } else if (!isDateTime && defaultValue.includes("T")) {
                    setDefaultValue(defaultValue.split("T")[0]);
                  }
                }
              }}
            />
          </section>
        );
      case FieldType.TIME:
        return (
          <section>
            <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">
              时间显示格式
            </label>
            <Select
              portal={true}
              options={TIME_FORMATS}
              value={format}
              onChange={(val) => setFormat(val)}
            />
          </section>
        );
      case FieldType.SELECT:
      case FieldType.MULTI_SELECT:
        return (
          <section className="space-y-3">
            {renderModelSelector()}
            <div className="flex justify-between items-center">
              <label className="block text-xs font-semibold text-gray-400 uppercase">
                选项内容
              </label>
              <div className="flex items-center gap-3">
                {options.length > 0 && (
                  <button
                    onClick={() => setShowConfirmClear(true)}
                    className="text-[10px] text-gray-400 font-bold hover:text-red-500 transition-colors"
                  >
                    清空
                  </button>
                )}
                <button
                  onClick={handleAiGenerateOptions}
                  disabled={isAiOptionsLoading || !name}
                  className="text-[10px] text-primary-600 font-bold flex items-center gap-1 hover:text-primary-800 disabled:opacity-50 transition-colors"
                >
                  {isAiOptionsLoading ? (
                    "生成中..."
                  ) : (
                    <>
                      <ICONS.Robot />
                      AI 生成选项
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-2 pr-2">
              {options.map((opt, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 bg-gray-50 border border-gray-100 px-2 py-1.5 rounded-md hover:border-gray-200 transition-colors group"
                >
                  <OptionColorPicker
                    color={optionColors[opt] || "gray"}
                    onChange={(color) => {
                      setOptionColors((prev) => ({ ...prev, [opt]: color }));
                    }}
                    trigger={
                      <Tooltip content="点击修改颜色">
                        <div
                          className={`w-4 h-4 rounded-full flex-shrink-0 border border-gray-200 shadow-sm cursor-pointer ${getOptionColorStyle(opt)}`}
                        />
                      </Tooltip>
                    }
                  />
                  <input
                    value={opt}
                    onChange={(e) => handleOptionChange(idx, e.target.value)}
                    className="flex-1 text-sm bg-transparent outline-none text-gray-700"
                    placeholder="输入选项名称"
                  />
                  <button
                    onClick={() => handleDeleteOption(idx)}
                    className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                  >
                    <ICONS.Close className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {options.length === 0 && (
                <div className="text-xs text-gray-400 text-center py-2">
                  暂无选项，请手动添加或使用 AI 生成
                </div>
              )}
            </div>
            <button
              onClick={handleAddOption}
              className="w-full py-2 border border-dashed border-gray-200 rounded-lg text-xs text-primary-500 hover:bg-primary-50 font-medium"
            >
              + 添加选项
            </button>
          </section>
        );
      case FieldType.FORMULA:
        return (
          <section className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">
                公式编辑
              </label>
              <textarea
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                rows={3}
                placeholder="例如: {单价} * {数量}"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary-500 outline-none bg-gray-50"
              />
              <div className="text-[10px] text-gray-400 mt-1">
                使用 {"{列名}"} 来引用表中的其它字段
              </div>
            </div>

            <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100 space-y-2">
              <div className="flex items-center gap-2 text-indigo-700 font-bold text-xs uppercase">
                <ICONS.Robot /> AI 公式助手
              </div>
              {renderModelSelector()}
              <div className="flex gap-2">
                <input
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="描述你想要实现的逻辑..."
                  className="flex-1 text-xs border border-indigo-200 rounded px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
                <button
                  onClick={handleAiGenerateFormula}
                  disabled={isAiGenerating || !aiPrompt}
                  className="bg-indigo-600 text-white text-[10px] font-bold px-3 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50 transition-all shrink-0"
                >
                  {isAiGenerating ? "生成中..." : "AI 生成"}
                </button>
              </div>
            </div>
          </section>
        );
      case FieldType.LINK:
        return (
          <section>
            <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">
              关联目标表
            </label>
            <Select
              portal={true}
              options={allTables.map((t) => ({ label: t.name, value: t.id }))}
              value={linkedTableId}
              onChange={(val) => setLinkedTableId(val)}
            />
            <p className="text-[10px] text-gray-400 mt-1">
              选择要引用的数据表。修改目标表的数据时，此处会自动更新。
            </p>
          </section>
        );
      case FieldType.LOOKUP:
        const linkFields = allColumns.filter((c) => c.type === FieldType.LINK);
        const selectedRelation = linkFields.find(
          (c) => c.id === lookupRelationColId,
        );
        const targetTable = selectedRelation
          ? allTables.find(
              (t) => t.id === selectedRelation.config?.linked_table_id,
            )
          : null;

        return (
          <section className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">
                1. 选择关联字段
              </label>
              {linkFields.length > 0 ? (
                <Select
                  portal={true}
                  options={[
                    { label: "请选择...", value: "" },
                    ...linkFields.map((c) => ({ label: c.name, value: c.id })),
                  ]}
                  value={lookupRelationColId}
                  onChange={(val) => {
                    setLookupRelationColId(val);
                    setLookupTargetColId("");
                  }}
                />
              ) : (
                <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded border border-orange-100">
                  当前表没有关联字段，无法使用引用功能。请先创建一个“关联引用”字段。
                </div>
              )}
            </div>

            {targetTable && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">
                  2. 选择要显示的字段 ({targetTable.name})
                </label>
                <Select
                  portal={true}
                  options={[
                    { label: "请选择...", value: "" },
                    ...targetTableColumns.map((c) => ({
                      label: c.name,
                      value: c.id,
                    })),
                  ]}
                  value={lookupTargetColId}
                  onChange={(val) => setLookupTargetColId(val)}
                />
              </div>
            )}
          </section>
        );
      case FieldType.SEARCH_REFERENCE:
        const queryTargetTable = allTables.find(
          (t) => t.id === queryTargetTableId,
        );
        return (
          <section className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">
                需要引用的字段
              </label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Select
                    portal={true}
                    options={[
                      { label: "引用字段所在的数据表", value: "" },
                      ...allTables.map((t) => ({ label: t.name, value: t.id })),
                    ]}
                    value={queryTargetTableId}
                    onChange={(val) => {
                      setQueryTargetTableId(val);
                      setQueryTargetFieldId("");
                      setQueryFilters([
                        {
                          target_condition_field_id: "",
                          operator: "EQ",
                          current_field_id: "",
                        },
                      ]);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <Select
                    portal={true}
                    options={[
                      { label: "选择引用字段", value: "" },
                      ...targetTableColumns.map((c) => ({
                        label: c.name,
                        value: c.id,
                      })),
                    ]}
                    value={queryTargetFieldId}
                    onChange={(val) => setQueryTargetFieldId(val)}
                    disabled={!queryTargetTable}
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">
                查找条件
              </label>
              <div className="flex flex-col gap-2">
                {queryFilters.map((filter, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="flex-1">
                      <Select
                        portal={true}
                        options={[
                          { label: "引用表中的字段", value: "" },
                          ...targetTableColumns.map((c) => ({
                            label: c.name,
                            value: c.id,
                          })),
                        ]}
                        value={filter.target_condition_field_id}
                        onChange={(val) => {
                          const newFilters = [...queryFilters];
                          newFilters[index].target_condition_field_id = val;
                          setQueryFilters(newFilters);
                        }}
                        disabled={!queryTargetTable}
                      />
                    </div>

                    <div className="flex-1">
                      <Select
                        portal={true}
                        options={
                          searchConditions.length > 0
                            ? searchConditions
                            : [{ label: "等于", value: "EQ" }]
                        }
                        value={filter.operator}
                        onChange={(val) => {
                          const newFilters = [...queryFilters];
                          newFilters[index].operator = val;
                          setQueryFilters(newFilters);
                        }}
                      />
                    </div>

                    <div className="flex-1 flex items-center gap-1">
                      <div className="flex-1">
                        <Select
                          portal={true}
                          options={[
                            { label: "当前表中的字段", value: "" },
                            ...allColumns.map((c) => ({
                              label: c.name,
                              value: c.id,
                            })),
                          ]}
                          value={filter.current_field_id || ""}
                          onChange={(val) => {
                            const newFilters = [...queryFilters];
                            newFilters[index].current_field_id = val;
                            setQueryFilters(newFilters);
                          }}
                        />
                      </div>
                      {queryFilters.length > 1 && (
                        <button
                          className="p-1.5 text-gray-400 hover:text-red-500 rounded-md hover:bg-gray-100 transition-colors"
                          onClick={() => {
                            const newFilters = [...queryFilters];
                            newFilters.splice(index, 1);
                            setQueryFilters(newFilters);
                          }}
                        >
                          <ICONS.Close className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div
                className="mt-2 text-primary-600 text-xs font-medium cursor-pointer hover:underline flex items-center gap-1 w-fit"
                onClick={() => {
                  setQueryFilters([
                    ...queryFilters,
                    {
                      target_condition_field_id: "",
                      operator: "EQ",
                      current_field_id: "",
                    },
                  ]);
                }}
              >
                <ICONS.Plus className="w-3 h-3" /> 添加条件
              </div>
            </div>
          </section>
        );
      default:
        return null;
    }
  };

  const [showUserSelector, setShowUserSelector] = useState(false);
  const [showDeptSelector, setShowDeptSelector] = useState(false);

  const renderDefaultValueInput = () => {
    if (
      type === FieldType.FORMULA ||
      type === FieldType.LINK ||
      type === FieldType.LOOKUP ||
      type === FieldType.SEARCH_REFERENCE ||
      type === FieldType.ATTACHMENT
    )
      return null;

    switch (type) {
      case FieldType.USER:
        const users = parseJsonArray(defaultValue);
        return (
          <div className="relative">
            <div
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-[38px] flex flex-wrap gap-1 cursor-pointer bg-white items-center"
              onClick={() => setShowUserSelector(!showUserSelector)}
            >
              {users.length > 0 ? (
                users.map((u: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded-full text-[10px] border border-primary-100 shrink-0"
                  >
                    <div className="w-3.5 h-3.5 rounded-full bg-primary-200 flex items-center justify-center overflow-hidden text-[8px]">
                      {u.avatar_url || u.avatar ? (
                        <img
                          src={u.avatar_url || u.avatar}
                          className="w-full h-full object-cover"
                          alt=""
                        />
                      ) : (
                        (u.real_name || u.name)?.[0] || "U"
                      )}
                    </div>
                    <span className="truncate max-w-[60px]">
                      {u.real_name || u.name}
                    </span>
                    <button
                      className="ml-0.5 hover:text-primary-900"
                      onClick={(e) => {
                        e.stopPropagation();
                        const nextUsers = users.filter(
                          (_: any, index: number) => index !== i,
                        );
                        setDefaultValue(nextUsers.length > 0 ? nextUsers : []);
                      }}
                    >
                      <ICONS.Close className="w-3 h-3" />
                    </button>
                  </div>
                ))
              ) : (
                <span className="text-gray-400 text-xs">点击选择默认人员</span>
              )}
            </div>
            {showUserSelector && (
              <UserSelector
                value={defaultValue}
                onChange={(val) => setDefaultValue(val)}
                onClose={() => setShowUserSelector(false)}
              />
            )}
          </div>
        );
      case FieldType.DEPARTMENT:
        const depts = parseJsonArray(defaultValue);
        return (
          <div className="relative">
            <div
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-[38px] flex flex-wrap gap-1 cursor-pointer bg-white items-center"
              onClick={() => setShowDeptSelector(!showDeptSelector)}
            >
              {depts.length > 0 ? (
                depts.map((d: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-[10px] border border-gray-200 shrink-0"
                  >
                    <ICONS.Building className="w-3 h-3 text-gray-500" />
                    <span className="truncate max-w-[80px]">
                      {d.name || d.dept_name}
                    </span>
                  </div>
                ))
              ) : (
                <span className="text-gray-400 text-xs">点击选择默认部门</span>
              )}
            </div>
            {showDeptSelector && (
              <DepartmentSelector
                value={defaultValue}
                onChange={(val) => setDefaultValue(val)}
                onClose={() => setShowDeptSelector(false)}
              />
            )}
          </div>
        );
      case FieldType.SELECT:
        return (
          <Select
            portal={true}
            options={[
              { label: "请选择选项", value: "" },
              ...options.map((opt) => ({ label: opt, value: opt })),
            ]}
            value={defaultValue}
            onChange={(val) => setDefaultValue(val)}
          />
        );
      case FieldType.NUMBER:
        return (
          <input
            type="number"
            value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
            placeholder="输入默认数字"
          />
        );
      case FieldType.DATE: {
        const isDateTime = format.includes("HH:mm");
        const isCurrentSelected =
          defaultValue === "current_date" ||
          defaultValue === "current_datetime";
        const isSpecificDate = defaultValue && !isCurrentSelected;

        const getTriggerLabel = () => {
          if (!defaultValue) return "不选择默认值";
          if (isCurrentSelected) {
            return isDateTime ? "添加新记录的创建时间" : "添加新记录的创建日期";
          }
          return defaultValue;
        };

        return (
          <div ref={dateContainerRef} className="relative w-full">
            <button
              type="button"
              onClick={() => {
                setIsDateSelectOpen(!isDateSelectOpen);
                setIsDateCalendarOpen(false);
              }}
              className="w-full min-h-[36px] px-3 py-2 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50/50 rounded-xl flex items-center justify-between transition-all duration-200 text-sm shadow-sm outline-none cursor-pointer"
            >
              <span
                className={`truncate text-xs ${!defaultValue ? "text-gray-400" : "text-gray-700"}`}
              >
                {getTriggerLabel()}
              </span>
              <ICONS.ChevronDown
                className={`w-4 h-4 shrink-0 text-gray-400 transition-transform duration-200 ${isDateSelectOpen ? "rotate-180" : ""}`}
              />
            </button>

            {/* Popover dropdown options */}
            {isDateSelectOpen && (
              <div className="absolute left-0 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                <div
                  onClick={() => {
                    setDefaultValue("");
                    setIsDateSelectOpen(false);
                    setIsDateCalendarOpen(false);
                  }}
                  className={`px-3 py-2 cursor-pointer text-xs flex items-center justify-between hover:bg-gray-50 ${!defaultValue ? "bg-primary-50/50 text-primary-700 font-medium" : "text-gray-700"}`}
                >
                  <span>不选择默认值</span>
                  {!defaultValue && (
                    <ICONS.Check className="w-4 h-4 text-primary-600 shrink-0 ml-2" />
                  )}
                </div>

                <div
                  onClick={() => {
                    setDefaultValue(
                      isDateTime ? "current_datetime" : "current_date",
                    );
                    setIsDateSelectOpen(false);
                    setIsDateCalendarOpen(false);
                  }}
                  className={`px-3 py-2 cursor-pointer text-xs flex items-center justify-between hover:bg-gray-50 ${isCurrentSelected ? "bg-primary-50/50 text-primary-700 font-medium" : "text-gray-700"}`}
                >
                  <span>
                    {isDateTime
                      ? "添加新记录的创建时间"
                      : "添加新记录的创建日期"}
                  </span>
                  {isCurrentSelected && (
                    <ICONS.Check className="w-4 h-4 text-primary-600 shrink-0 ml-2" />
                  )}
                </div>

                <div
                  onClick={() => {
                    setIsDateCalendarOpen(true);
                    setIsDateSelectOpen(false);
                  }}
                  className={`relative px-3 py-2 cursor-pointer text-xs flex items-center justify-between hover:bg-gray-50 text-gray-700 ${isSpecificDate ? "bg-primary-50/50 text-primary-700 font-medium" : ""}`}
                >
                  <span>
                    {isDateTime ? "选择具体日期和时间" : "选择具体日期"}
                  </span>
                  <svg
                    className="w-3.5 h-3.5 text-gray-400 shrink-0 ml-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
            )}

            {isDateCalendarOpen && (
              <DateTimePickerPopup
                type={FieldType.DATE}
                isDateTime={isDateTime}
                value={defaultValue}
                onSelect={(val) => setDefaultValue(val)}
                onClose={() => setIsDateCalendarOpen(false)}
                anchorRef={dateContainerRef}
              />
            )}
          </div>
        );
      }
      case FieldType.TIME: {
        const isCurrentSelected = defaultValue === "current_time";
        const isSpecificTime = defaultValue && !isCurrentSelected;

        const getTriggerLabel = () => {
          if (!defaultValue) return "不选择默认值";
          if (isCurrentSelected) {
            return "添加新记录的当前时间";
          }
          return defaultValue;
        };

        return (
          <div ref={timeContainerRef} className="relative w-full">
            <button
              type="button"
              onClick={() => {
                setIsTimeSelectOpen(!isTimeSelectOpen);
                setIsTimeCalendarOpen(false);
              }}
              className="w-full min-h-[36px] px-3 py-2 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50/50 rounded-xl flex items-center justify-between transition-all duration-200 text-sm shadow-sm outline-none cursor-pointer"
            >
              <span
                className={`truncate text-xs ${!defaultValue ? "text-gray-400" : "text-gray-700"}`}
              >
                {getTriggerLabel()}
              </span>
              <ICONS.ChevronDown
                className={`w-4 h-4 shrink-0 text-gray-400 transition-transform duration-200 ${isTimeSelectOpen ? "rotate-180" : ""}`}
              />
            </button>

            {/* Popover dropdown options */}
            {isTimeSelectOpen && (
              <div className="absolute left-0 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                <div
                  onClick={() => {
                    setDefaultValue("");
                    setIsTimeSelectOpen(false);
                    setIsTimeCalendarOpen(false);
                  }}
                  className={`px-3 py-2 cursor-pointer text-xs flex items-center justify-between hover:bg-gray-50 ${!defaultValue ? "bg-primary-50/50 text-primary-700 font-medium" : "text-gray-700"}`}
                >
                  <span>不选择默认值</span>
                  {!defaultValue && (
                    <ICONS.Check className="w-4 h-4 text-primary-600 shrink-0 ml-2" />
                  )}
                </div>

                <div
                  onClick={() => {
                    setDefaultValue("current_time");
                    setIsTimeSelectOpen(false);
                    setIsTimeCalendarOpen(false);
                  }}
                  className={`px-3 py-2 cursor-pointer text-xs flex items-center justify-between hover:bg-gray-50 ${isCurrentSelected ? "bg-primary-50/50 text-primary-700 font-medium" : "text-gray-700"}`}
                >
                  <span>添加新记录的当前时间</span>
                  {isCurrentSelected && (
                    <ICONS.Check className="w-4 h-4 text-primary-600 shrink-0 ml-2" />
                  )}
                </div>

                <div
                  onClick={() => {
                    setIsTimeCalendarOpen(true);
                    setIsTimeSelectOpen(false);
                  }}
                  className={`relative px-3 py-2 cursor-pointer text-xs flex items-center justify-between hover:bg-gray-50 text-gray-700 ${isSpecificTime ? "bg-primary-50/50 text-primary-700 font-medium" : ""}`}
                >
                  <span>选择具体时间</span>
                  <svg
                    className="w-3.5 h-3.5 text-gray-400 shrink-0 ml-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
            )}

            {isTimeCalendarOpen && (
              <DateTimePickerPopup
                type={FieldType.TIME}
                isDateTime={false}
                value={defaultValue}
                onSelect={(val) => setDefaultValue(val)}
                onClose={() => setIsTimeCalendarOpen(false)}
                anchorRef={timeContainerRef}
              />
            )}
          </div>
        );
      }
      case FieldType.CHECKBOX:
        return (
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!defaultValue}
              onChange={(e) => setDefaultValue(e.target.checked)}
              className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
            />
            <span className="text-sm text-gray-600">默认勾选</span>
          </div>
        );
      default:
        return (
          <input
            value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
            placeholder="输入默认内容"
          />
        );
    }
  };

  const [position, setPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (mode === "popover" && anchorEl) {
      let top = 0;
      let left = 0;
      if (anchorEl instanceof HTMLElement) {
        const rect = anchorEl.getBoundingClientRect();
        top = rect.top;
        left = rect.right + 8;
      } else if (anchorEl && "top" in anchorEl) {
        top = anchorEl.top;
        left = anchorEl.left;
      }

      // Boundary check
      if (top + 600 > window.innerHeight) {
        top = window.innerHeight - 600;
      }
      const dialogWidth = type === FieldType.SEARCH_REFERENCE ? 420 : 320;
      if (left + dialogWidth > window.innerWidth - 20) {
        // If it goes beyond the right edge, push it to the left, but make sure it doesn't go off the left edge.
        // If it's a popover next to an element, we might want to flip it to the left side of the element.
        if (anchorEl instanceof HTMLElement) {
          const rect = anchorEl.getBoundingClientRect();
          // Try to place on the left if there's no room on the right
          if (rect.left - dialogWidth - 8 > 20) {
            left = rect.left - dialogWidth - 8;
          } else {
            left = window.innerWidth - dialogWidth - 20;
          }
        } else {
          left = window.innerWidth - dialogWidth - 20;
        }
      }
      if (top < 0) top = 20;
      if (left < 0) left = 20;

      setPosition({ top, left });
    }
  }, [anchorEl, mode, type]);

  const content = (
    <div
      data-modal-portal="true"
      className={`bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${mode === "modal" ? "w-full max-w-md" : (type === FieldType.SEARCH_REFERENCE ? "w-[420px]" : "w-[320px]") + " max-h-[600px] border border-gray-200"}`}
    >
      <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
        <section>
          <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">
            标题
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
            placeholder="输入字段名称"
          />
        </section>

        <section>
          <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">
            字段类型
          </label>
          <Select
            portal={true}
            options={fieldTypes.map((t) => ({
              label: t.label,
              value: t.value,
            }))}
            value={type}
            onChange={(val) => {
              setType(val);
              let targetFormat = "";
              if (val === FieldType.NUMBER)
                targetFormat = NUMBER_FORMATS[0].value;
              if (val === FieldType.DATE) targetFormat = DATE_FORMATS[0].value;
              if (val === FieldType.TIME) targetFormat = TIME_FORMATS[1].value;
              if (targetFormat) setFormat(targetFormat);

              setDefaultValue("");
            }}
          />
        </section>

        {renderTypeSpecificConfigs()}

        {type !== FieldType.FORMULA &&
          type !== FieldType.LINK &&
          type !== FieldType.LOOKUP &&
          type !== FieldType.SEARCH_REFERENCE && (
            <section>
              <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">
                默认值
              </label>
              {renderDefaultValueInput()}
            </section>
          )}

        <section className="pt-2 border-t border-gray-100 flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">
            在当前视图中显示
          </label>
          <button
            onClick={() => setVisible(!visible)}
            className={`w-11 h-6 flex items-center rounded-full transition-colors duration-200 ease-in-out ${visible ? "bg-primary-600" : "bg-gray-200"}`}
          >
            <span
              className={`w-4 h-4 bg-white rounded-full shadow transform transition-transform duration-200 ease-in-out ${visible ? "translate-x-6" : "translate-x-1"}`}
            />
          </button>
        </section>
      </div>

      <div className="bg-gray-50 p-4 flex justify-between items-center border-t border-gray-100">
        <div>
          {column && onDelete && !isPrimary && (
            <button
              onClick={handleDelete}
              className="text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-bold transition-colors"
            >
              删除字段
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "保存中..." : "确定"}
          </button>
        </div>
      </div>
    </div>
  );

  if (mode === "popover") {
    return createPortal(
      <>
        <div
          className="fixed inset-0 z-[110]"
          onClick={onClose}
          data-modal-portal="true"
        />
        <div
          className="fixed z-[111]"
          style={{ top: position.top, left: position.left }}
          data-modal-portal="true"
        >
          {content}
        </div>

        <ConfirmDialog
          isOpen={showConfirmDelete}
          title="删除字段"
          message="确定要删除此字段吗？与该字段相关的所有数据将永久丢失。"
          onConfirm={confirmDelete}
          onCancel={() => setShowConfirmDelete(false)}
        />

        <ConfirmDialog
          isOpen={showConfirmClear}
          title="清空选项"
          message="确定要清空所有选项吗？此操作将移除所有已定义的选项。"
          onConfirm={() => {
            setOptions([]);
            setShowConfirmClear(false);
          }}
          onCancel={() => setShowConfirmClear(false)}
        />
      </>,
      document.body,
    );
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-[110] flex items-center justify-center p-4">
      {content}

      <ConfirmDialog
        isOpen={showConfirmDelete}
        title="删除字段"
        message="确定要删除此字段吗？与该字段相关的所有数据将永久丢失。"
        onConfirm={confirmDelete}
        onCancel={() => setShowConfirmDelete(false)}
      />

      <ConfirmDialog
        isOpen={showConfirmClear}
        title="清空选项"
        message="确定要清空所有选项吗？此操作将移除所有已定义的选项。"
        onConfirm={() => {
          setOptions([]);
          setShowConfirmClear(false);
        }}
        onCancel={() => setShowConfirmClear(false)}
      />
    </div>
  );
};

export default FieldConfigDialog;
