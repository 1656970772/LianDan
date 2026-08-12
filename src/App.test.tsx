import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

describe("炼丹规则推演台", () => {
  it("载入默认预设但不会自动制造结果", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "炼丹规则推演台" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "测试预设" })).toHaveValue("preset_juqi_upper");
    expect(screen.getByText("等待第一次推演")).toBeInTheDocument();
  });

  it("固定显示三主药、两辅药和一药引共六个槽位", () => {
    render(<App />);

    const recipe = screen.getByRole("region", { name: "丹方配伍" });
    expect(within(recipe).getByRole("button", { name: /^主药一，/ })).toBeInTheDocument();
    expect(within(recipe).getByRole("button", { name: /^主药二，/ })).toBeInTheDocument();
    expect(within(recipe).getByRole("button", { name: /^主药三，/ })).toBeInTheDocument();
    expect(within(recipe).getByRole("button", { name: /^辅药一，/ })).toBeInTheDocument();
    expect(within(recipe).getByRole("button", { name: /^辅药二，/ })).toBeInTheDocument();
    expect(within(recipe).getByRole("button", { name: /^药引，/ })).toBeInTheDocument();
  });

  it("选中槽位后点击背包药材，每次增加一份", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^主药二，/ }));
    const backpackItem = screen.getByRole("button", { name: /寒髓枝，背包剩余/ });
    await user.click(backpackItem);
    expect(screen.getByRole("button", { name: "主药二，寒髓枝，数量 1" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /寒髓枝，背包剩余/ }));
    expect(screen.getByRole("button", { name: "主药二，寒髓枝，数量 2" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /寒髓枝/ })).not.toBeInTheDocument();
  });

  it("拖拽松手后才显示数量弹框，确认后批量放入", async () => {
    const user = userEvent.setup();
    render(<App />);
    const item = screen.getByRole("button", { name: /寒髓枝，背包剩余/ });
    const target = screen.getByRole("button", { name: /^辅药二，/ }).closest("article");
    expect(target).not.toBeNull();

    fireEvent.dragStart(item, {
      dataTransfer: {
        effectAllowed: "copy",
        setData: vi.fn(),
      },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.drop(target!, {
      clientX: 600,
      clientY: 360,
      dataTransfer: {
        getData: (type: string) => type === "application/x-alchemy-material" ? "material_hansui_zhi" : "",
      },
    });

    const dialog = screen.getByRole("dialog", { name: "寒髓枝" });
    expect(within(dialog).getByRole("slider", { name: "放入数量" })).toHaveValue("3");
    expect(screen.getByRole("button", { name: /辅药二，空槽/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认放入" }));
    expect(screen.getByRole("button", { name: "辅药二，寒髓枝，数量 3" })).toBeInTheDocument();
  });

  it("悬停背包图标时显示材料详情，但不显示常驻材料表单", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole("combobox", { name: /保存状态|来源/ })).not.toBeInTheDocument();
    await user.hover(screen.getByRole("button", { name: /寒髓枝，背包剩余/ }));
    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText("寒髓枝")).toBeInTheDocument();
    expect(within(tooltip).getByText(/极寒灵液凝成/)).toBeInTheDocument();
    expect(within(tooltip).getByText(/寒性 98/)).toBeInTheDocument();
  });

  it("点击主操作后显示最终丹药与折叠判定依据", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "推演成丹" }));
    expect(screen.getByText("成丹成功")).toBeInTheDocument();
    await user.click(screen.getByText("查看完整判定依据"));
    expect(screen.getByRole("heading", { name: "最终判定依据" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "候选分析" })).toBeInTheDocument();
  });

  it("修改因素后保留并标记旧结果", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "推演成丹" }));

    fireEvent.change(screen.getByRole("spinbutton", { name: "炉温精确数值" }), {
      target: { value: "73" },
    });

    expect(screen.getByText("配伍或属性已改变，结果待重新推演")).toBeInTheDocument();
    expect(screen.getByText("结果已过期")).toBeInTheDocument();
    expect(screen.getByText("成丹成功")).toBeInTheDocument();
  });

  it("支持 Ctrl + Enter 推演和搜索背包", async () => {
    const user = userEvent.setup();
    render(<App />);

    const search = screen.getByRole("searchbox", { name: "搜索药材或标签" });
    await user.type(search, "寒髓枝");
    expect(screen.getByRole("button", { name: /寒髓枝，背包剩余/ })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    expect(screen.queryByText("等待第一次推演")).not.toBeInTheDocument();
  });
});
