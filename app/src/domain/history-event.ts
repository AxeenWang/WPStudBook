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
  /** 目前子系統或親系統更新，保存舊名與新名；subjectId 為系位置 id（需求規格 7.1、LINE-06）。 */
  | 'lineSystemsChanged'
  /** 種牡馬開始任期；subjectId 為馬匹 id。 */
  | 'stallionDutyStarted'
  /** 繁殖牝馬加入母馬群；subjectId 為馬匹 id。 */
  | 'mareAdded'
  /** 賣出繁殖牝馬；subjectId 為馬匹 id。 */
  | 'mareSold'
  /** 定年引退離圈（需求規格 8.5、11.5）；subjectId 為馬匹 id。 */
  | 'mareRetired'
  /** 已離圈的母馬重新出現在五月總表而回歸（需求規格 11.5、ID-04）；subjectId 為馬匹 id。 */
  | 'mareReturned'
  /** 據點變更（轉場），含時點；subjectId 為馬匹 id。 */
  | 'mareTransferred'
  /** 待指定用途的母馬被指定母馬群（需求規格 11.5）；subjectId 為馬匹 id。 */
  | 'mareGroupAssigned'
  /** 年度資料人工更正，保存前後值；subjectId 為馬匹 id。 */
  | 'mareYearlyChanged'
  /** 遊戲局設定變更；subjectId 為 game。 */
  | 'settingsChanged'
  /** 年度工作清單的人工更正，保存前後的完成狀態；subjectId 為 game（需求規格 13.2）。 */
  | 'annualWorkCorrected'
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
  | 'lineGenerationEstablished'
  /** 斷血補系宣告、補入親馬或結束，保存前後值；subjectId 為補系紀錄 id（需求規格 7.6）。 */
  | 'recoveryChanged'
  /** 自家產駒成為種牡馬（需求規格 9.7），含種牡馬馬番号；subjectId 為馬匹 id。 */
  | 'becameStallion'
  /**
   * 自家產駒第一次出現在十月全世界繁殖牝馬總表的其他牧場（需求規格 9.7、11.10），
   * 含所在牧場與繁殖牝馬馬番号；subjectId 為馬匹 id。
   */
  | 'becameMareElsewhere'
  /** 在其他牧場的自家產駒所在牧場變更，保存前後牧場（11.10、OCT-05）；subjectId 為馬匹 id。 */
  | 'mareElsewhereMoved'
  /** 現任任期狀態變更或被更換，保存前後值；subjectId 為馬匹 id。 */
  | 'stallionDutyChanged'
  /**
   * 五月種牡馬總表的在表狀態變更（需求規格 11.8、STL-10）；subjectId 為馬匹 id。
   * 只在非現役標示出現或消失時寫，年年更新最後在表年份不寫事件。
   */
  | 'stallionListingChanged'
  /** 預定後繼指定、就緒狀態、確認產駒或結束，保存前後值；subjectId 為系位置 id。 */
  | 'plannedSuccessorChanged'
  /** 總合評價與爆發力新增或更正，保存前後值；subjectId 為母馬 id。 */
  | 'matingRatingRecorded';

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
