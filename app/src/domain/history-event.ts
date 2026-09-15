import type { JsonValue } from './json.ts';
import type { Timing } from './timing.ts';

/** 整局層級事件的對象。不使用 gameId，還原為新遊戲局時不必改寫事件。 */
export const GAME_SUBJECT_ID = 'game';

export type HistoryEventType =
  | 'gameYearChanged'
  | 'schemaMigrated'
  /** 系統對照表新增、修改或刪除；subjectId 為對照表紀錄 id。 */
  | 'systemMapChanged'
  /** 手動建立馬匹；subjectId 為馬匹 id。 */
  | 'horseCreated'
  /** 開啟系位置；subjectId 為系位置 id。 */
  | 'lineOpened'
  /** 種牡馬開始任期；subjectId 為馬匹 id。 */
  | 'stallionDutyStarted'
  /** 繁殖牝馬加入母馬群；subjectId 為馬匹 id。 */
  | 'mareAdded'
  /** 賣出繁殖牝馬；subjectId 為馬匹 id。 */
  | 'mareSold'
  /** 據點變更（轉場），含時點；subjectId 為馬匹 id。 */
  | 'mareTransferred'
  /** 年度資料人工更正，保存前後值；subjectId 為馬匹 id。 */
  | 'mareYearlyChanged'
  /** 遊戲局設定變更；subjectId 為 game。 */
  | 'settingsChanged'
  /** 年度繁殖紀錄登記或更正，保存前後值；subjectId 為母馬 id。 */
  | 'breedingRecorded'
  /** 產駒出生（手動登記）；subjectId 為產駒 id。 */
  | 'foalBorn'
  /** 產駒能力、適性、牧場處置或備註更正，保存前後值；subjectId 為產駒 id。 */
  | 'foalChanged'
  /** 正式馬名補登、取代或清空，保存前後值；subjectId 為馬匹 id。 */
  | 'horseNamed'
  /** 姊妹接替狀態變更（正式保留、已被取代）；subjectId 為母馬 id。 */
  | 'successionChanged'
  /** 母馬世代成立；subjectId 為系位置 id。 */
  | 'lineGenerationEstablished';

export type HistoryEventSource = 'user' | 'migration';

export interface HistoryEvent {
  readonly id: string;
  readonly subjectId: string;
  readonly type: HistoryEventType;
  readonly gameYear: number;
  readonly timing?: Timing;
  readonly before?: JsonValue;
  readonly after?: JsonValue;
  readonly source: HistoryEventSource;
  readonly occurredAt: string;
}
