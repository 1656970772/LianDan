import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

describe("炼丹规则工作台", () => {
  it("载入默认预设但不会自动制造结果", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "炼丹规则工作台" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "测试预设" })).toHaveValue("preset_juqi_upper");
    expect(screen.getByText("等待第一次推演")).toBeInTheDocument();
  });

  it("点击主操作后显示最终丹药与原因摘要", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "推演成丹" }));

    expect(screen.getByText("成丹成功")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "最终判定依据" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "候选分析" })).toBeInTheDocument();
  });

  it("按材料类别显示魔核专属状态、来源与兽龄", () => {
    render(<App />);

    const heading = screen.getAllByRole("heading", { name: "水系二阶魔核" })
      .find((candidate) => candidate.tagName === "H4");
    expect(heading).toBeDefined();
    const row = heading!.closest("li");
    expect(row).not.toBeNull();
    const scoped = within(row!);
    expect(scoped.getByText("魔核 · 基础剂量 2")).toBeInTheDocument();
    expect(scoped.getByRole("combobox", { name: "水系二阶魔核保存状态" })).toHaveValue("state_intact");
    expect(scoped.getByRole("combobox", { name: "水系二阶魔核来源" })).toHaveValue("origin_beast");
    expect(scoped.getByText("兽龄")).toBeInTheDocument();
  });

  it("修改因素后保留并标记旧结果", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "推演成丹" }));

    fireEvent.change(screen.getByRole("spinbutton", { name: "炉温精确数值" }), {
      target: { value: "73" },
    });

    expect(screen.getByText("输入已改变，结果待重新推演")).toBeInTheDocument();
    expect(screen.getByText("结果已过期")).toBeInTheDocument();
    expect(screen.getByText("成丹成功")).toBeInTheDocument();
  });

  it("支持 Ctrl + Enter 推演，并能通过搜索加入药材", async () => {
    const user = userEvent.setup();
    render(<App />);

    const search = screen.getByRole("searchbox", { name: "搜索药材或标签" });
    await user.type(search, "寒髓枝");
    await user.click(screen.getByRole("button", { name: "加入寒髓枝" }));
    expect(screen.getByRole("button", { name: "寒髓枝已加入，本炉共1份" })).toBeDisabled();

    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    expect(screen.queryByText("等待第一次推演")).not.toBeInTheDocument();
  });
});
