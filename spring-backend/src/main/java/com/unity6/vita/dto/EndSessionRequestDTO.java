package com.unity6.vita.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EndSessionRequestDTO {
    private Long sessionId;
    private Long profileId;
    private List<ConversationMessageDTO> conversation;
}