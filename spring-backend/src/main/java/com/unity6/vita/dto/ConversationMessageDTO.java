package com.unity6.vita.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ConversationMessageDTO {
    private String role;  // "user" or "assistant"
    private String text;
    private String timestamp;
}