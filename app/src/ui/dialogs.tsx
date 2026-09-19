import { useState, type ReactNode } from 'react';
import {
  Button,
  Dialog,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  TextField,
} from 'react-aria-components';

interface ConfirmDialogProps {
  readonly title: string;
  readonly confirmLabel: string;
  readonly isConfirmDisabled?: boolean | undefined;
  /** 破壞性操作使用 alertdialog，且不能點外面關閉。 */
  readonly isDestructive?: boolean | undefined;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly children: ReactNode;
}

/** 掛載即開啟；由呼叫端以條件渲染控制是否顯示。 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const destructive = props.isDestructive === true;
  return (
    <ModalOverlay
      isOpen
      isDismissable={!destructive}
      onOpenChange={(open) => {
        if (!open) {
          props.onCancel();
        }
      }}
      className="modal-overlay"
    >
      <Modal className="modal">
        <Dialog role={destructive ? 'alertdialog' : 'dialog'} className="dialog">
          <Heading slot="title">{props.title}</Heading>
          {props.children}
          <div className="dialog-actions">
            <Button onPress={props.onCancel}>取消</Button>
            <Button onPress={props.onConfirm} isDisabled={props.isConfirmDisabled === true}>
              {props.confirmLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** 表單對話框：標頭含標題與關閉鈕，內容由呼叫端提供；點外面或 Esc 關閉。 */
export function FormDialog({
  title,
  description,
  onClose,
  children,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      className="modal-overlay"
    >
      <Modal className="modal">
        <Dialog className="dialog">
          <div className="dialog-head">
            <div>
              <Heading slot="title">{title}</Heading>
              {description !== undefined && <p>{description}</p>}
            </div>
            <Button className="dialog-close" aria-label="關閉" onPress={onClose}>
              <span aria-hidden="true">×</span>
            </Button>
          </div>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

interface TypedNameDialogProps {
  readonly title: string;
  readonly description: ReactNode;
  readonly expectedName: string;
  readonly confirmLabel: string;
  readonly onConfirm: (typedName: string) => void;
  readonly onCancel: () => void;
}

/** 危險區確認：輸入完全相同的局名才能確認（需求規格 12.1、DATA-10）。 */
export function TypedNameDialog(props: TypedNameDialogProps) {
  const [typed, setTyped] = useState('');
  return (
    <ConfirmDialog
      title={props.title}
      confirmLabel={props.confirmLabel}
      isDestructive
      isConfirmDisabled={typed !== props.expectedName}
      onConfirm={() => {
        props.onConfirm(typed);
      }}
      onCancel={props.onCancel}
    >
      {props.description}
      <TextField value={typed} onChange={setTyped} autoFocus>
        <Label>請輸入局名「{props.expectedName}」確認</Label>
        <Input />
      </TextField>
    </ConfirmDialog>
  );
}
