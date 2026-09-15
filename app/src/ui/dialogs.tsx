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
